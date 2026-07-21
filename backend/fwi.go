package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"sync"
	"time"
)

// =============================================================================
// Fire Weather Index (FWI) System
// Based on the Canadian Forest Fire Weather Index System
// Reference: https://cwfis.cfs.nrcan.gc.ca/background/summary/fwi
// =============================================================================

// FWIData holds the calculated Fire Weather Index components
type FWIData struct {
	// Input values
	Temperature   float64 `json:"temperature"`   // °C
	Humidity      float64 `json:"humidity"`      // %
	WindSpeed     float64 `json:"wind_speed"`    // km/h
	Precipitation float64 `json:"precipitation"` // mm (24h)

	// Fuel Moisture Codes
	FFMC float64 `json:"ffmc"` // Fine Fuel Moisture Code (0-101)
	DMC  float64 `json:"dmc"`  // Duff Moisture Code (0-∞)
	DC   float64 `json:"dc"`   // Drought Code (0-∞)

	// Fire Behavior Indices
	ISI float64 `json:"isi"` // Initial Spread Index
	BUI float64 `json:"bui"` // Buildup Index
	FWI float64 `json:"fwi"` // Fire Weather Index

	// Danger rating
	DangerClass     string `json:"danger_class"`     // Low, Moderate, High, Very High, Extreme
	DangerColor     string `json:"danger_color"`     // Color code for UI
	SpreadPotential string `json:"spread_potential"` // Description

	// Metadata
	Location  string    `json:"location"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	UpdatedAt time.Time `json:"updated_at"`
}

const (
	defaultFFMC = 85.0
	defaultDMC  = 6.0
	defaultDC   = 15.0
	fwiCacheTTL = 10 * time.Minute
)

type FWICache struct {
	mu        sync.RWMutex
	data      map[string]*FWIData
	updatedAt time.Time
}

var (
	fwiCache                        = &FWICache{}
	fwiFetchMu                      sync.Mutex
	fetchWeatherAndCalculateFWIFunc = FetchWeatherAndCalculateFWI
)

func (c *FWICache) GetFresh() (map[string]*FWIData, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.data) == 0 || time.Since(c.updatedAt) > fwiCacheTTL {
		return nil, false
	}
	return copyFWIMap(c.data), true
}

func (c *FWICache) GetAny() (map[string]*FWIData, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if len(c.data) == 0 {
		return nil, false
	}
	return copyFWIMap(c.data), true
}

func (c *FWICache) Set(data map[string]*FWIData) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.data = copyFWIMap(data)
	c.updatedAt = time.Now()
}

func copyFWIMap(data map[string]*FWIData) map[string]*FWIData {
	copied := make(map[string]*FWIData, len(data))
	for k, v := range data {
		if v == nil {
			continue
		}
		value := *v
		copied[k] = &value
	}
	return copied
}

// =============================================================================
// Wind Grid Cache - Wind data for fire locations
// =============================================================================

type WindPoint struct {
	Lat       float64 `json:"lat"`
	Lon       float64 `json:"lon"`
	Speed     float64 `json:"speed"`     // km/h
	Direction float64 `json:"direction"` // degrees
}

type WindGridCache struct {
	mu          sync.RWMutex
	points      []WindPoint
	lastUpdated time.Time
}

var windGrid = &WindGridCache{
	points: []WindPoint{},
}

// GetWindForLocation returns interpolated wind for a specific lat/lon
func (w *WindGridCache) GetWindForLocation(lat, lon float64) (speed, direction float64) {
	w.mu.RLock()
	defer w.mu.RUnlock()

	if len(w.points) == 0 {
		return 0, 0
	}

	// Find nearest grid point
	minDist := math.MaxFloat64
	for _, p := range w.points {
		dist := math.Sqrt(math.Pow(p.Lat-lat, 2) + math.Pow(p.Lon-lon, 2))
		if dist < minDist {
			minDist = dist
			speed = p.Speed
			direction = p.Direction
		}
	}

	return speed, direction
}

// FetchWindGrid fetches wind data for all Chilean monitoring points
func FetchWindGrid() error {
	// Create a timeout context for the entire operation
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var points []WindPoint
	var mu sync.Mutex
	var wg sync.WaitGroup

	client := &http.Client{Timeout: 10 * time.Second}

	for _, point := range ChileanMonitoringPoints {
		wg.Add(1)
		go func(lat, lon float64) {
			defer wg.Done()

			url := fmt.Sprintf(
				"https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&current=wind_speed_10m,wind_direction_10m&timezone=America/Santiago",
				lat, lon,
			)

			req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
			if err != nil {
				log.Printf("Wind fetch request error for (%.2f, %.2f): %v", lat, lon, err)
				return
			}

			resp, err := client.Do(req)
			if err != nil {
				log.Printf("Wind fetch error for (%.2f, %.2f): %v", lat, lon, err)
				return
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				log.Printf("Wind fetch bad status for (%.2f, %.2f): %d", lat, lon, resp.StatusCode)
				return
			}

			var data struct {
				Current struct {
					WindSpeed     float64 `json:"wind_speed_10m"`
					WindDirection float64 `json:"wind_direction_10m"`
				} `json:"current"`
			}

			if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
				log.Printf("Wind decode error for (%.2f, %.2f): %v", lat, lon, err)
				return
			}

			mu.Lock()
			points = append(points, WindPoint{
				Lat:       lat,
				Lon:       lon,
				Speed:     data.Current.WindSpeed,
				Direction: data.Current.WindDirection,
			})
			mu.Unlock()
		}(point.Lat, point.Lon)
	}

	wg.Wait()

	windGrid.mu.Lock()
	windGrid.points = points
	windGrid.lastUpdated = time.Now()
	windGrid.mu.Unlock()

	return nil
}

// IsWindGridStale returns true if wind data needs refresh (older than 10 minutes)
func (w *WindGridCache) IsStale() bool {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return time.Since(w.lastUpdated) > 10*time.Minute
}

// =============================================================================
// FWI Calculation Functions
// =============================================================================

// CalculateFFMC calculates the Fine Fuel Moisture Code
// FFMC represents moisture content of litter and fine fuels
func CalculateFFMC(temp, rh, wind, rain, prevFFMC float64) float64 {
	// Convert previous FFMC to moisture content
	mo := 147.2 * (101.0 - prevFFMC) / (59.5 + prevFFMC)

	// Rain effect
	if rain > 0.5 {
		rf := rain - 0.5
		if mo <= 150.0 {
			mr := mo + 42.5*rf*math.Exp(-100.0/(251.0-mo))*(1.0-math.Exp(-6.93/rf))
			if mr > 250.0 {
				mr = 250.0
			}
			mo = mr
		} else {
			mr := mo + 42.5*rf*math.Exp(-100.0/(251.0-mo))*(1.0-math.Exp(-6.93/rf)) +
				0.0015*math.Pow(mo-150.0, 2)*math.Sqrt(rf)
			if mr > 250.0 {
				mr = 250.0
			}
			mo = mr
		}
	}

	// Equilibrium Moisture Content for drying
	ed := 0.942*math.Pow(rh, 0.679) + 11.0*math.Exp((rh-100.0)/10.0) +
		0.18*(21.1-temp)*(1.0-math.Exp(-0.115*rh))

	// Equilibrium Moisture Content for wetting
	ew := 0.618*math.Pow(rh, 0.753) + 10.0*math.Exp((rh-100.0)/10.0) +
		0.18*(21.1-temp)*(1.0-math.Exp(-0.115*rh))

	var m float64
	if mo > ed {
		// Drying
		ko := 0.424*(1.0-math.Pow(rh/100.0, 1.7)) + 0.0694*math.Sqrt(wind)*(1.0-math.Pow(rh/100.0, 8))
		kd := ko * 0.581 * math.Exp(0.0365*temp)
		m = ed + (mo-ed)*math.Pow(10.0, -kd)
	} else if mo < ew {
		// Wetting
		k1 := 0.424*(1.0-math.Pow((100.0-rh)/100.0, 1.7)) + 0.0694*math.Sqrt(wind)*(1.0-math.Pow((100.0-rh)/100.0, 8))
		kw := k1 * 0.581 * math.Exp(0.0365*temp)
		m = ew - (ew-mo)*math.Pow(10.0, -kw)
	} else {
		m = mo
	}

	// Convert moisture content back to FFMC
	ffmc := 59.5 * (250.0 - m) / (147.2 + m)
	if ffmc > 101.0 {
		ffmc = 101.0
	}
	if ffmc < 0.0 {
		ffmc = 0.0
	}

	return ffmc
}

// CalculateDMC calculates the Duff Moisture Code
// DMC represents moisture content of loosely compacted organic layers
func CalculateDMC(temp, rh, rain, prevDMC float64, month int) float64 {
	// Day length adjustment factors
	dayLengthFactors := []float64{6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.4, 8.0, 7.0, 6.0}

	// Adjust for southern hemisphere
	adjustedMonth := (month + 6) % 12
	Le := dayLengthFactors[adjustedMonth]

	po := prevDMC

	// Rain effect
	if rain > 1.5 {
		re := 0.92*rain - 1.27
		mo := 20.0 + math.Exp(5.6348-po/43.43)
		var b float64
		if po <= 33.0 {
			b = 100.0 / (0.5 + 0.3*po)
		} else if po <= 65.0 {
			b = 14.0 - 1.3*math.Log(po)
		} else {
			b = 6.2*math.Log(po) - 17.2
		}
		mr := mo + 1000.0*re/(48.77+b*re)
		pr := 244.72 - 43.43*math.Log(mr-20.0)
		if pr < 0.0 {
			pr = 0.0
		}
		po = pr
	}

	// Temperature effect
	if temp > -1.1 {
		K := 1.894 * (temp + 1.1) * (100.0 - rh) * Le * 0.000001
		dmc := po + 100.0*K
		return dmc
	}

	return po
}

// CalculateDC calculates the Drought Code
// DC represents moisture content of deep compact organic layers
func CalculateDC(temp, rain, prevDC float64, month int) float64 {
	// Day length factors for DC
	Lf := []float64{-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6}

	// Adjust for southern hemisphere
	adjustedMonth := (month + 6) % 12

	Do := prevDC

	// Rain effect
	if rain > 2.8 {
		rd := 0.83*rain - 1.27
		Qo := 800.0 * math.Exp(-Do/400.0)
		Qr := Qo + 3.937*rd
		Dr := 400.0 * math.Log(800.0/Qr)
		if Dr < 0.0 {
			Dr = 0.0
		}
		Do = Dr
	}

	// Temperature effect
	if temp > -2.8 {
		V := 0.36*(temp+2.8) + Lf[adjustedMonth]
		if V < 0.0 {
			V = 0.0
		}
		dc := Do + 0.5*V
		return dc
	}

	return Do
}

// CalculateISI calculates the Initial Spread Index
// ISI is a numeric rating of the expected rate of fire spread
func CalculateISI(ffmc, wind float64) float64 {
	m := 147.2 * (101.0 - ffmc) / (59.5 + ffmc)
	fW := math.Exp(0.05039 * wind)
	fF := 91.9 * math.Exp(-0.1386*m) * (1.0 + math.Pow(m, 5.31)/(4.93*1e7))
	isi := 0.208 * fW * fF
	return isi
}

// CalculateBUI calculates the Buildup Index
// BUI is a numeric rating of the total amount of fuel available for combustion
func CalculateBUI(dmc, dc float64) float64 {
	var bui float64
	if dmc <= 0.4*dc {
		bui = 0.8 * dmc * dc / (dmc + 0.4*dc)
	} else {
		bui = dmc - (1.0-0.8*dc/(dmc+0.4*dc))*(0.92+(math.Pow(0.0114*dmc, 1.7)))
	}
	if bui < 0.0 {
		bui = 0.0
	}
	return bui
}

// CalculateFWI calculates the Fire Weather Index
// FWI is a numeric rating of fire intensity
func CalculateFWI(isi, bui float64) float64 {
	var fD float64
	if bui <= 80.0 {
		fD = 0.626*math.Pow(bui, 0.809) + 2.0
	} else {
		fD = 1000.0 / (25.0 + 108.64*math.Exp(-0.023*bui))
	}

	B := 0.1 * isi * fD

	var fwi float64
	if B > 1.0 {
		fwi = math.Exp(2.72 * math.Pow(0.434*math.Log(B), 0.647))
	} else {
		fwi = B
	}

	return fwi
}

// GetDangerClass returns the danger class based on FWI value
func GetDangerClass(fwi float64) (string, string, string) {
	switch {
	case fwi < 5:
		return "Bajo", "#22c55e", "Propagacion minima esperada"
	case fwi < 12:
		return "Moderado", "#eab308", "Propagacion lenta a moderada"
	case fwi < 21:
		return "Alto", "#f97316", "Propagacion moderada a rapida"
	case fwi < 38:
		return "Muy Alto", "#ef4444", "Propagacion rapida, comportamiento agresivo"
	default:
		return "Extremo", "#dc2626", "Propagacion explosiva, fuera de control"
	}
}

// =============================================================================
// Weather Data Fetching
// =============================================================================

type OpenMeteoResponse struct {
	Current struct {
		Time          string  `json:"time"`
		Temperature   float64 `json:"temperature_2m"`
		Humidity      float64 `json:"relative_humidity_2m"`
		WindSpeed     float64 `json:"wind_speed_10m"`
		Precipitation float64 `json:"precipitation"`
		WindDirection float64 `json:"wind_direction_10m"`
	} `json:"current"`
	Daily struct {
		PrecipitationSum []float64 `json:"precipitation_sum"`
	} `json:"daily"`
}

// FetchWeatherAndCalculateFWI fetches weather data and calculates FWI
func FetchWeatherAndCalculateFWI(lat, lon float64) (*FWIData, error) {
	url := fmt.Sprintf(
		"https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,wind_direction_10m&daily=precipitation_sum&timezone=America/Santiago&past_days=1",
		lat, lon,
	)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch weather: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("weather API returned status %d", resp.StatusCode)
	}

	var weather OpenMeteoResponse
	if err := json.NewDecoder(resp.Body).Decode(&weather); err != nil {
		return nil, fmt.Errorf("failed to decode weather: %w", err)
	}

	if weather.Current.Time == "" {
		return nil, fmt.Errorf("weather API response missing current conditions")
	}

	// Get 24h precipitation (yesterday's total)
	precip24h := 0.0
	if len(weather.Daily.PrecipitationSum) > 0 {
		precip24h = weather.Daily.PrecipitationSum[0]
	}

	// Get current month for DMC/DC calculations
	month := time.Now().Month()

	// Calculate FWI components
	ffmc := CalculateFFMC(weather.Current.Temperature, weather.Current.Humidity, weather.Current.WindSpeed, precip24h, defaultFFMC)
	dmc := CalculateDMC(weather.Current.Temperature, weather.Current.Humidity, precip24h, defaultDMC, int(month))
	dc := CalculateDC(weather.Current.Temperature, precip24h, defaultDC, int(month))
	isi := CalculateISI(ffmc, weather.Current.WindSpeed)
	bui := CalculateBUI(dmc, dc)
	fwi := CalculateFWI(isi, bui)

	dangerClass, dangerColor, spreadPotential := GetDangerClass(fwi)

	return &FWIData{
		Temperature:     weather.Current.Temperature,
		Humidity:        weather.Current.Humidity,
		WindSpeed:       weather.Current.WindSpeed,
		Precipitation:   precip24h,
		FFMC:            math.Round(ffmc*10) / 10,
		DMC:             math.Round(dmc*10) / 10,
		DC:              math.Round(dc*10) / 10,
		ISI:             math.Round(isi*10) / 10,
		BUI:             math.Round(bui*10) / 10,
		FWI:             math.Round(fwi*10) / 10,
		DangerClass:     dangerClass,
		DangerColor:     dangerColor,
		SpreadPotential: spreadPotential,
		Latitude:        lat,
		Longitude:       lon,
		UpdatedAt:       time.Now(),
	}, nil
}

// =============================================================================
// FWI for Multiple Chilean Locations
// =============================================================================

var ChileanMonitoringPoints = []struct {
	Name string
	Lat  float64
	Lon  float64
}{
	{"Arica", -18.48, -70.31},
	{"Iquique", -20.21, -70.14},
	{"Antofagasta", -23.65, -70.40},
	{"Copiapo", -27.37, -70.33},
	{"La Serena", -29.90, -71.25},
	{"Valparaiso", -33.05, -71.62},
	{"Santiago", -33.45, -70.65},
	{"Rancagua", -34.17, -70.74},
	{"Talca", -35.43, -71.67},
	{"Chillan", -36.61, -72.10},
	{"Concepcion", -36.83, -73.05},
	{"Temuco", -38.74, -72.60},
	{"Valdivia", -39.81, -73.24},
	{"Puerto Montt", -41.47, -72.94},
	{"Coyhaique", -45.57, -72.07},
	{"Punta Arenas", -53.16, -70.91},
}

// FetchAllFWI fetches FWI for all monitoring points with a short shared cache.
func FetchAllFWI() (map[string]*FWIData, error) {
	if cached, ok := fwiCache.GetFresh(); ok {
		return cached, nil
	}

	fwiFetchMu.Lock()
	defer fwiFetchMu.Unlock()

	if cached, ok := fwiCache.GetFresh(); ok {
		return cached, nil
	}

	stale, hasStale := fwiCache.GetAny()
	results, err := fetchAllFWIUncached()
	if err != nil {
		if hasStale {
			log.Printf("Serving stale FWI data after refresh failure: %v", err)
			return stale, nil
		}
		return nil, err
	}
	if hasStale && len(results) < len(ChileanMonitoringPoints) {
		merged := copyFWIMap(stale)
		for location, data := range results {
			merged[location] = data
		}
		log.Printf("Serving partial FWI refresh for %d/%d locations while preserving stale entries", len(results), len(ChileanMonitoringPoints))
		return merged, nil
	}

	fwiCache.Set(results)
	return copyFWIMap(results), nil
}

func fetchAllFWIUncached() (map[string]*FWIData, error) {
	results := make(map[string]*FWIData)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, point := range ChileanMonitoringPoints {
		wg.Add(1)
		go func(name string, lat, lon float64) {
			defer wg.Done()
			fwi, err := fetchWeatherAndCalculateFWIFunc(lat, lon)
			if err != nil {
				log.Printf("FWI fetch error for %s: %v", name, err)
				return
			}
			fwi.Location = name
			mu.Lock()
			results[name] = fwi
			mu.Unlock()
		}(point.Name, point.Lat, point.Lon)
	}

	wg.Wait()
	if len(results) == 0 {
		return nil, fmt.Errorf("no FWI data available")
	}
	return results, nil
}

// =============================================================================
// HTTP Handler
// =============================================================================

func getFWIHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Check for specific location
	lat := r.URL.Query().Get("lat")
	lon := r.URL.Query().Get("lon")

	if lat != "" || lon != "" {
		if lat == "" || lon == "" {
			http.Error(w, "lat and lon must be provided together", http.StatusBadRequest)
			return
		}

		latF, err := parseCoordinateParam("lat", lat, -90, 90)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		lonF, err := parseCoordinateParam("lon", lon, -180, 180)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		fwi, err := FetchWeatherAndCalculateFWI(latF, lonF)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(fwi)
		return
	}

	// Return all Chilean monitoring points
	results, err := FetchAllFWI()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(results)
}
