package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"
	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
)

// Chilean timezone for user-facing timestamps
var chileTZ = func() *time.Location {
	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		log.Printf("Warning: could not load America/Santiago timezone, falling back to UTC: %v", err)
		return time.UTC
	}
	return loc
}()

// =============================================================================
// Thread-Safe In-Memory Cache
// =============================================================================

type FireCache struct {
	mu          sync.RWMutex
	data        FeatureCollection
	lastUpdated time.Time
	nextRefresh time.Time
	sourceCount map[string]int
	lastError   string
	lastErrorAt time.Time
}

var cache = &FireCache{
	data: FeatureCollection{
		Type:     "FeatureCollection",
		Features: []Feature{},
	},
	sourceCount: make(map[string]int),
}

func (c *FireCache) Get() (FeatureCollection, time.Time) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.data, c.lastUpdated
}

func (c *FireCache) GetSourceCount() map[string]int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	result := make(map[string]int)
	for k, v := range c.sourceCount {
		result[k] = v
	}
	return result
}

func (c *FireCache) Set(data FeatureCollection, counts map[string]int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.data = data
	c.lastUpdated = time.Now()
	c.nextRefresh = time.Now().Add(1 * time.Minute)
	c.sourceCount = counts
	c.lastError = ""
	c.lastErrorAt = time.Time{}
}

func (c *FireCache) GetNextRefresh() time.Time {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.nextRefresh
}

func (c *FireCache) SetError(err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err == nil {
		c.lastError = ""
		c.lastErrorAt = time.Time{}
		return
	}
	c.lastError = err.Error()
	c.lastErrorAt = time.Now()
	c.nextRefresh = time.Now().Add(1 * time.Minute)
}

func (c *FireCache) GetError() (string, time.Time) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.lastError, c.lastErrorAt
}

// =============================================================================
// WebSocket Hub
// =============================================================================

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
}

type WSClient struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (c *WSClient) WriteJSON(v interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteJSON(v)
}

type WSHub struct {
	clients    map[*WSClient]bool
	broadcast  chan WSMessage
	register   chan *WSClient
	unregister chan *WSClient
	mu         sync.Mutex
}

var hub = &WSHub{
	clients:    make(map[*WSClient]bool),
	broadcast:  make(chan WSMessage, 100),
	register:   make(chan *WSClient, 100),
	unregister: make(chan *WSClient, 100),
}

var fetchFromSourceFunc = fetchFromSource

func (h *WSHub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("WebSocket client connected. Total: %d", len(h.clients))

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				client.conn.Close()
			}
			h.mu.Unlock()
			log.Printf("WebSocket client disconnected. Total: %d", len(h.clients))

		case message := <-h.broadcast:
			h.mu.Lock()
			for client := range h.clients {
				err := client.WriteJSON(message)
				if err != nil {
					client.conn.Close()
					delete(h.clients, client)
				}
			}
			h.mu.Unlock()
		}
	}
}

func (h *WSHub) BroadcastUpdate(data FeatureCollection) {
	h.broadcast <- WSMessage{
		Type:    "update",
		Payload: data,
	}
}

func (h *WSHub) BroadcastAlert(alert FireAlert) {
	h.broadcast <- WSMessage{
		Type:    "alert",
		Payload: alert,
	}
}

// =============================================================================
// NASA FIRMS Data Fetcher
// =============================================================================

// Chile bounding box
const (
	ChileWest  = -75.6
	ChileSouth = -55.9
	ChileEast  = -66.4
	ChileNorth = -17.5
)

func fetchFIRMSData() error {
	apiKey := strings.TrimSpace(os.Getenv("NASA_FIRMS_API_KEY"))
	if apiKey == "" {
		return fmt.Errorf("NASA_FIRMS_API_KEY not set")
	}

	var allFeatures []Feature
	sourceCounts := make(map[string]int)
	previousFeatures := make(map[string]bool)

	// Get previous fire IDs for alert comparison
	oldData, _ := cache.Get()
	for _, f := range oldData.Features {
		key := GetObservationID(f.Properties.GridID, f.Properties.Satellite, f.Properties.AcqDate, f.Properties.AcqTime)
		previousFeatures[key] = true
	}

	// FIRMS servers to try (primary and fallback)
	firmsServers := []string{
		"https://firms.modaps.eosdis.nasa.gov",
		"https://firms2.modaps.eosdis.nasa.gov",
	}

	// Fetch from all satellite sources
	for _, source := range SatelliteSources {
		var features []Feature
		var lastErr error

		// Try each server until one works
		for _, server := range firmsServers {
			url := fmt.Sprintf(
				"%s/api/area/csv/%s/%s/%f,%f,%f,%f/2",
				server, apiKey, source.ID, ChileWest, ChileSouth, ChileEast, ChileNorth,
			)

			log.Printf("Fetching %s data from %s...", source.Name, server)

			features, lastErr = fetchFromSourceFunc(url, source.Name)
			if lastErr == nil {
				break // Success, use this server
			}
			log.Printf("Server %s failed for %s: %v, trying next...", server, source.Name, lastErr)
		}

		if lastErr != nil {
			log.Printf("Warning: All servers failed for %s: %v", source.Name, lastErr)
			continue
		}

		sourceCounts[source.Name] = len(features)
		allFeatures = append(allFeatures, features...)

		// Check for high-FRP alerts (new fires in Chile only)
		for _, f := range features {
			if f.Properties.Country != "Chile" {
				continue
			}
			key := GetObservationID(f.Properties.GridID, f.Properties.Satellite, f.Properties.AcqDate, f.Properties.AcqTime)
			if !previousFeatures[key] && f.Properties.FRP >= 50 {
				location := f.Properties.RegionName
				if location == "" {
					location = "Chile"
				}
				hub.BroadcastAlert(FireAlert{
					Feature:   f,
					AlertType: "high_frp",
					Message:   fmt.Sprintf("Incendio de alta intensidad detectado en %s (FRP %.0f MW)", location, f.Properties.FRP),
				})
			}
		}
	}

	if len(sourceCounts) == 0 {
		err := fmt.Errorf("all FIRMS sources failed; preserving previous cache")
		cache.SetError(err)
		return err
	}

	// Build metadata
	sources := make([]string, 0, len(sourceCounts))
	for s := range sourceCounts {
		sources = append(sources, s)
	}

	sourceNotice := "Las detecciones de incendios activos de NASA FIRMS son observaciones satelitales y pueden estar retrasadas o incluir falsos positivos."
	officialNotice := "Matta Fire es informativo y no reemplaza a CONAF, SENAPRED, Bomberos ni las instrucciones de las autoridades locales."

	collection := FeatureCollection{
		Type:     "FeatureCollection",
		Features: allFeatures,
		Metadata: &Metadata{
			TotalCount:             len(allFeatures),
			Sources:                sources,
			LastUpdated:            time.Now(),
			BoundingBox:            []float64{ChileWest, ChileSouth, ChileEast, ChileNorth},
			FetchedAt:              time.Now().UTC(),
			RefreshIntervalSeconds: 60,
			SourceNotice:           sourceNotice,
			OfficialNotice:         officialNotice,
		},
	}

	cache.Set(collection, sourceCounts)

	// Broadcast update to WebSocket clients
	hub.BroadcastUpdate(collection)

	log.Printf("Successfully cached %d fire points from %d sources", len(allFeatures), len(sourceCounts))
	return nil
}

func fetchFromSource(url, sourceName string) ([]Feature, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read body for logging/debugging
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(body))
	}

	// Log first 200 chars of response for debugging
	preview := string(body)
	if len(preview) > 200 {
		preview = preview[:200]
	}
	log.Printf("[%s] Response preview: %s", sourceName, preview)

	// Check for API errors in response body
	bodyStr := string(body)
	if strings.Contains(bodyStr, "Invalid MAP_KEY") {
		return nil, fmt.Errorf("invalid API key - check NASA_FIRMS_API_KEY environment variable")
	}
	if strings.Contains(bodyStr, "Invalid API call") {
		return nil, fmt.Errorf("invalid API call format")
	}

	// Parse CSV from body bytes
	return parseCSV(strings.NewReader(bodyStr), sourceName)
}

func parseCSV(r io.Reader, sourceName string) ([]Feature, error) {
	reader := csv.NewReader(r)

	header, err := reader.Read()
	if err != nil {
		return nil, fmt.Errorf("failed to read CSV header: %w", err)
	}

	colIndex := make(map[string]int)
	for i, col := range header {
		colIndex[strings.ToLower(strings.TrimSpace(col))] = i
	}

	var features []Feature

	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		// Skip low-confidence detections *before* parseRecord side effects
		// (sun glint, industrial heat sources, volcanic activity)
		if idx, ok := colIndex["confidence"]; ok && idx < len(record) {
			conf := strings.ToLower(strings.TrimSpace(record[idx]))
			if conf == "l" || conf == "low" {
				continue
			}
		}

		feature, err := parseRecord(record, colIndex, sourceName)
		if err != nil {
			continue
		}

		features = append(features, feature)
	}

	return features, nil
}

func parseRecord(record []string, colIndex map[string]int, sourceName string) (Feature, error) {
	getFloat := func(name string) float64 {
		if idx, ok := colIndex[name]; ok && idx < len(record) {
			val, _ := strconv.ParseFloat(strings.TrimSpace(record[idx]), 64)
			return val
		}
		return 0
	}

	getString := func(name string) string {
		if idx, ok := colIndex[name]; ok && idx < len(record) {
			return strings.TrimSpace(record[idx])
		}
		return ""
	}

	lat := getFloat("latitude")
	lon := getFloat("longitude")

	if lat == 0 && lon == 0 {
		return Feature{}, fmt.Errorf("invalid coordinates")
	}

	frp := getFloat("frp")
	acqDate := getString("acq_date")
	acqTime := getString("acq_time")

	// Calculate timestamp and observed time for time slider (UTC)
	timestamp, observedAt := parseFIRMSTime(acqDate, acqTime)

	// Determine intensity level
	intensity := "low"
	if frp >= 100 {
		intensity = "extreme"
	} else if frp >= 50 {
		intensity = "high"
	} else if frp >= 20 {
		intensity = "medium"
	}

	// Determine location
	region := determineRegion(lat, lon)
	regionName := determineRegionName(region)
	country := determineCountry(lat, lon, region)

	// Get wind data for this location from the grid
	windSpeed, windDirection := windGrid.GetWindForLocation(lat, lon)

	// Add to fire history (deduplication happens here)
	fireRecord := fireHistory.AddDetection(lat, lon, frp, region, sourceName, acqDate, acqTime, observedAt, windSpeed, windDirection)

	return Feature{
		Type: "Feature",
		Geometry: Geometry{
			Type:        "Point",
			Coordinates: []float64{lon, lat},
		},
		Properties: Properties{
			Latitude:      lat,
			Longitude:     lon,
			Brightness:    getFloat("bright_ti4"),
			Scan:          getFloat("scan"),
			Track:         getFloat("track"),
			AcqDate:       acqDate,
			AcqTime:       acqTime,
			Satellite:     sourceName,
			Instrument:    getString("instrument"),
			Confidence:    getString("confidence"),
			Version:       getString("version"),
			BrightT31:     getFloat("bright_ti5"),
			FRP:           frp,
			DayNight:      getString("daynight"),
			Timestamp:     timestamp,
			ObservedAt:    observedAt,
			Region:        region,
			RegionName:    regionName,
			Country:       country,
			Intensity:     intensity,
			WindSpeed:     windSpeed,
			WindDirection: windDirection,
			// Fire history data
			GridID:         fireRecord.GridID,
			DetectionCount: fireRecord.DetectionCount,
			Severity:       fireRecord.Severity,
			FirstSeen:      fireRecord.FirstSeen.In(chileTZ).Format("02-01 15:04"),
			Duration:       fireRecord.DurationString(),
			MaxFRP:         fireRecord.MaxFRP,
		},
	}, nil
}

func parseTimestamp(date, timeStr string) int64 {
	// Date format: 2026-01-21, Time format: 0516 (HHMM)
	if len(date) < 10 || len(timeStr) < 4 {
		return time.Now().Unix()
	}

	hour, _ := strconv.Atoi(timeStr[:2])
	minute, _ := strconv.Atoi(timeStr[2:4])

	t, err := time.Parse("2006-01-02", date)
	if err != nil {
		return time.Now().Unix()
	}

	t = t.Add(time.Duration(hour)*time.Hour + time.Duration(minute)*time.Minute)
	return t.Unix()
}

// parseFIRMSTime interprets FIRMS acq_date and acq_time as UTC and returns Unix timestamp and ObservedAt time.
func parseFIRMSTime(acqDate, acqTime string) (unix int64, observedAt time.Time) {
	// Normalize acqTime to 4 digits (pad with leading zeros if needed)
	// FIRMS can return "432" instead of "0432"
	timeStr := acqTime
	for len(timeStr) < 4 {
		timeStr = "0" + timeStr
	}

	if len(acqDate) < 10 || len(timeStr) < 4 {
		now := time.Now().UTC()
		return now.Unix(), now
	}

	hour, hourErr := strconv.Atoi(timeStr[:2])
	minute, minuteErr := strconv.Atoi(timeStr[2:4])
	if hourErr != nil || minuteErr != nil || hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		now := time.Now().UTC()
		return now.Unix(), now
	}

	// Parse date in UTC explicitly
	t, err := time.Parse("2006-01-02", acqDate)
	if err != nil {
		now := time.Now().UTC()
		return now.Unix(), now
	}

	t = t.Add(time.Duration(hour)*time.Hour + time.Duration(minute)*time.Minute)
	observedAt = t.UTC()
	return observedAt.Unix(), observedAt
}

func determineRegion(lat, lon float64) string {
	for code, region := range ChileanRegions {
		if pointInPolygon(lon, lat, region.Polygon) {
			return code
		}
	}
	return "unknown"
}

func determineRegionName(regionCode string) string {
	if region, ok := ChileanRegions[regionCode]; ok {
		return region.Name
	}
	return ""
}

func determineCountry(lat, lon float64, regionCode string) string {
	if regionCode != "unknown" {
		return "Chile"
	}
	if isLikelyArgentina(lat, lon) {
		return "Argentina"
	}
	return "Fuera de Chile"
}

func isLikelyArgentina(lat, lon float64) bool {
	borderLon, ok := approximateChileArgentinaBorderLon(lat)
	if !ok {
		return false
	}
	return lon > borderLon
}

func approximateChileArgentinaBorderLon(lat float64) (float64, bool) {
	border := []struct {
		lat float64
		lon float64
	}{
		{-18.0, -69.0},
		{-22.0, -67.2},
		{-26.0, -68.6},
		{-30.0, -69.8},
		{-34.0, -70.0},
		{-38.0, -70.8},
		{-42.0, -71.5},
		{-46.0, -71.9},
		{-50.0, -72.3},
		{-52.0, -68.6},
		{-56.0, -68.6},
	}

	if lat > border[0].lat || lat < border[len(border)-1].lat {
		return 0, false
	}

	for i := 0; i < len(border)-1; i++ {
		north := border[i]
		south := border[i+1]
		if lat <= north.lat && lat >= south.lat {
			ratio := (lat - north.lat) / (south.lat - north.lat)
			return north.lon + ratio*(south.lon-north.lon), true
		}
	}

	return 0, false
}

func parseCoordinateParam(name, value string, min, max float64) (float64, error) {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		return 0, fmt.Errorf("invalid %s", name)
	}
	if parsed < min || parsed > max {
		return 0, fmt.Errorf("%s out of range", name)
	}
	return parsed, nil
}

// pointInPolygon checks if a point (x, y) is inside a polygon using ray casting algorithm
func pointInPolygon(x, y float64, polygon [][]float64) bool {
	n := len(polygon)
	if n < 3 {
		return false
	}

	inside := false
	for i, j := 0, n-1; i < n; j, i = i, i+1 {
		xi, yi := polygon[i][0], polygon[i][1]
		xj, yj := polygon[j][0], polygon[j][1]

		intersect := ((yi > y) != (yj > y)) &&
			(x < (xj-xi)*(y-yi)/(yj-yi)+xi)
		if intersect {
			inside = !inside
		}
	}

	return inside
}

// =============================================================================
// Filter Logic
// =============================================================================

func filterFeatures(features []Feature, input *FiresInput) []Feature {
	var result []Feature

	for _, f := range features {
		// Source filter
		if input.Source != "all" && input.Source != "" {
			if !strings.Contains(strings.ToUpper(f.Properties.Satellite), strings.ToUpper(input.Source)) {
				continue
			}
		}

		// Confidence filter
		if input.Confidence != "all" && input.Confidence != "" {
			conf := strings.ToLower(f.Properties.Confidence)
			switch strings.ToLower(input.Confidence) {
			case "low":
				if conf != "l" && conf != "low" {
					continue
				}
			case "nominal":
				if conf != "n" && conf != "nominal" {
					continue
				}
			case "high":
				if conf != "h" && conf != "high" {
					continue
				}
			}
		}

		// FRP filter
		if input.MinFRP > 0 && f.Properties.FRP < input.MinFRP {
			continue
		}
		if input.MaxFRP > 0 && f.Properties.FRP > input.MaxFRP {
			continue
		}

		// Intensity filter
		if input.Intensity != "all" && input.Intensity != "" {
			if !strings.EqualFold(f.Properties.Intensity, input.Intensity) {
				continue
			}
		}

		// Day/Night filter
		if input.DayNight != "all" && input.DayNight != "" {
			if strings.ToUpper(f.Properties.DayNight) != strings.ToUpper(input.DayNight) {
				continue
			}
		}

		// Region filter
		if input.Region != "all" && input.Region != "" {
			if f.Properties.Region != input.Region {
				continue
			}
		}

		// Time range filter (from_ts and to_ts)
		if input.FromTS > 0 && f.Properties.Timestamp < input.FromTS {
			continue
		}
		if input.ToTS > 0 && f.Properties.Timestamp > input.ToTS {
			continue
		}

		// Chile-only filter
		if input.ChileOnly && f.Properties.Country != "Chile" {
			continue
		}

		result = append(result, f)
	}

	return result
}

func metadataWithTotalCount(metadata *Metadata, total int) *Metadata {
	if metadata == nil {
		return nil
	}

	copy := *metadata
	if metadata.BoundingBox != nil {
		copy.BoundingBox = append([]float64(nil), metadata.BoundingBox...)
	}
	if metadata.Sources != nil {
		copy.Sources = append([]string(nil), metadata.Sources...)
	}
	copy.TotalCount = total
	return &copy
}

// =============================================================================
// Background Worker
// =============================================================================

func startBackgroundWorker(ctx context.Context) {
	// Initial wind grid fetch
	log.Println("Fetching initial wind grid data...")
	if err := FetchWindGrid(); err != nil {
		log.Printf("Initial wind grid fetch failed: %v", err)
	} else {
		log.Printf("Wind grid loaded: %d monitoring points", len(ChileanMonitoringPoints))
	}

	// Initial fire data fetch
	if err := fetchFIRMSData(); err != nil {
		log.Printf("Initial fetch failed: %v", err)
	}

	fireTicker := time.NewTicker(1 * time.Minute)
	windTicker := time.NewTicker(1 * time.Hour)    // Wind updates hourly
	cleanupTicker := time.NewTicker(1 * time.Hour) // Cleanup old fires hourly
	defer fireTicker.Stop()
	defer windTicker.Stop()
	defer cleanupTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("Background worker shutting down...")
			return
		case <-fireTicker.C:
			if err := fetchFIRMSData(); err != nil {
				log.Printf("Scheduled fetch failed: %v", err)
			}
			// Log fire history stats
			stats := fireHistory.GetStats()
			log.Printf("Fire history: %d unique fires, %d total detections",
				stats["total_unique_fires"], stats["total_detections"])
		case <-windTicker.C:
			log.Println("Refreshing wind grid data...")
			if err := FetchWindGrid(); err != nil {
				log.Printf("Wind grid refresh failed: %v", err)
			}
		case <-cleanupTicker.C:
			removed := fireHistory.Cleanup()
			if removed > 0 {
				log.Printf("Fire history cleanup: removed %d fires older than 24h", removed)
			}
		}
	}
}

// =============================================================================
// HTTP Handlers
// =============================================================================

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func getFiresHandler(ctx context.Context, input *FiresInput) (*FiresOutput, error) {
	data, _ := cache.Get()

	// Apply filters
	filtered := filterFeatures(data.Features, input)

	result := FeatureCollection{
		Type:     "FeatureCollection",
		Features: filtered,
		Metadata: metadataWithTotalCount(data.Metadata, len(filtered)),
	}

	return &FiresOutput{Body: result}, nil
}

func getHealthHandler(ctx context.Context, input *struct{}) (*HealthOutput, error) {
	data, lastUpdated := cache.Get()
	sourceCounts := cache.GetSourceCount()
	nextRefresh := cache.GetNextRefresh()
	lastError, lastErrorAt := cache.GetError()

	lastUpdatedStr := "never"
	if !lastUpdated.IsZero() {
		lastUpdatedStr = lastUpdated.Format(time.RFC3339)
	}

	status := "ok"
	lastErrorAtStr := ""
	if lastError != "" {
		status = "degraded"
		if !lastErrorAt.IsZero() {
			lastErrorAtStr = lastErrorAt.Format(time.RFC3339)
		}
	}

	return &HealthOutput{
		Body: HealthStatus{
			Status:      status,
			FireCount:   len(data.Features),
			LastUpdated: lastUpdatedStr,
			Sources:     sourceCounts,
			RefreshRate: "1 minute",
			NextRefresh: nextRefresh.Format(time.RFC3339),
			LastError:   lastError,
			LastErrorAt: lastErrorAtStr,
		},
	}, nil
}

func getRegionsHandler(ctx context.Context, input *struct{}) (*struct{ Body map[string]string }, error) {
	regions := make(map[string]string)
	for code, region := range ChileanRegions {
		regions[code] = region.Name
	}
	return &struct{ Body map[string]string }{Body: regions}, nil
}

func exportHandler(w http.ResponseWriter, r *http.Request) {
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "geojson"
	}

	// Parse filters from query params
	input := &FiresInput{
		Source:     r.URL.Query().Get("source"),
		Confidence: r.URL.Query().Get("confidence"),
		Intensity:  r.URL.Query().Get("intensity"),
		DayNight:   r.URL.Query().Get("daynight"),
		Region:     r.URL.Query().Get("region"),
	}

	if minFrp := r.URL.Query().Get("min_frp"); minFrp != "" {
		input.MinFRP, _ = strconv.ParseFloat(minFrp, 64)
	}
	if maxFrp := r.URL.Query().Get("max_frp"); maxFrp != "" {
		input.MaxFRP, _ = strconv.ParseFloat(maxFrp, 64)
	}
	if fromTs := r.URL.Query().Get("from_ts"); fromTs != "" {
		input.FromTS, _ = strconv.ParseInt(fromTs, 10, 64)
	}
	if toTs := r.URL.Query().Get("to_ts"); toTs != "" {
		input.ToTS, _ = strconv.ParseInt(toTs, 10, 64)
	}
	if chileOnly := r.URL.Query().Get("chile_only"); chileOnly == "true" {
		input.ChileOnly = true
	}

	data, _ := cache.Get()
	filtered := filterFeatures(data.Features, input)

	// Get metadata for notices
	var fetchedAt time.Time
	var sourceNotice string
	if data.Metadata != nil {
		fetchedAt = data.Metadata.FetchedAt
		sourceNotice = data.Metadata.SourceNotice
	}

	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", "attachment; filename=fires.csv")

		writer := csv.NewWriter(w)
		writer.Write([]string{"latitude", "longitude", "observed_at", "fetched_at", "brightness", "frp", "confidence", "acq_date", "acq_time", "satellite", "daynight", "country", "region", "region_name", "intensity", "severity", "detection_count", "max_frp", "wind_speed", "wind_direction", "source_notice"})

		for _, f := range filtered {
			p := f.Properties
			observedAtStr := ""
			if !p.ObservedAt.IsZero() {
				observedAtStr = p.ObservedAt.Format(time.RFC3339)
			}
			fetchedAtStr := ""
			if !fetchedAt.IsZero() {
				fetchedAtStr = fetchedAt.Format(time.RFC3339)
			}
			writer.Write([]string{
				fmt.Sprintf("%.5f", p.Latitude),
				fmt.Sprintf("%.5f", p.Longitude),
				observedAtStr,
				fetchedAtStr,
				fmt.Sprintf("%.2f", p.Brightness),
				fmt.Sprintf("%.2f", p.FRP),
				p.Confidence,
				p.AcqDate,
				p.AcqTime,
				p.Satellite,
				p.DayNight,
				p.Country,
				p.Region,
				p.RegionName,
				p.Intensity,
				p.Severity,
				fmt.Sprintf("%d", p.DetectionCount),
				fmt.Sprintf("%.2f", p.MaxFRP),
				fmt.Sprintf("%.2f", p.WindSpeed),
				fmt.Sprintf("%.0f", p.WindDirection),
				sourceNotice,
			})
		}
		writer.Flush()

	default: // geojson
		w.Header().Set("Content-Type", "application/geo+json")
		w.Header().Set("Content-Disposition", "attachment; filename=fires.geojson")

		result := FeatureCollection{
			Type:     "FeatureCollection",
			Features: filtered,
			Metadata: metadataWithTotalCount(data.Metadata, len(filtered)),
		}
		json.NewEncoder(w).Encode(result)
	}
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	client := &WSClient{conn: conn}
	hub.register <- client

	// Send current data immediately (using the mutex-protected WriteJSON)
	data, _ := cache.Get()
	client.WriteJSON(WSMessage{
		Type:    "update",
		Payload: data,
	})

	// Keep connection alive and handle disconnection
	go func() {
		defer func() {
			hub.unregister <- client
		}()
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				break
			}
		}
	}()
}

// Fire statistics endpoint
func getStatsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	stats := fireHistory.GetStats()
	json.NewEncoder(w).Encode(stats)
}

// Major fires endpoint (significant + major severity)
func getMajorFiresHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	majorFires := fireHistory.GetMajorFires()
	json.NewEncoder(w).Encode(majorFires)
}

// Wind data endpoint (using Open-Meteo free API)
func getWindHandler(w http.ResponseWriter, r *http.Request) {
	// Get wind data for Chile center
	lat := r.URL.Query().Get("lat")
	lon := r.URL.Query().Get("lon")

	if lat == "" {
		lat = "-33.45"
	}
	if lon == "" {
		lon = "-70.65"
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

	url := fmt.Sprintf(
		"https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&current=wind_speed_10m,wind_direction_10m&timezone=America/Santiago",
		latF, lonF,
	)

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		http.Error(w, fmt.Sprintf("wind API returned status %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if _, err := io.Copy(w, resp.Body); err != nil {
		log.Printf("Wind response write error: %v", err)
	}
}

// =============================================================================
// SPA Handler for frontend
// =============================================================================

// spaHandler serves static files and falls back to index.html for SPA routing
func spaHandler(staticDir string) http.Handler {
	fs := http.Dir(staticDir)
	fileServer := http.FileServer(fs)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path

		// Try to open the file
		f, err := fs.Open(path)
		if err != nil {
			// File doesn't exist, serve index.html for SPA routing
			http.ServeFile(w, r, staticDir+"/index.html")
			return
		}
		f.Close()

		// File exists, serve it
		fileServer.ServeHTTP(w, r)
	})
}

// =============================================================================
// Main
// =============================================================================

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}

	if os.Getenv("NASA_FIRMS_API_KEY") == "" {
		log.Fatal("NASA_FIRMS_API_KEY is required. Set it in .env or environment.")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start WebSocket hub
	go hub.run()

	// Start background worker
	go startBackgroundWorker(ctx)

	mux := http.NewServeMux()

	// Huma API
	api := humago.New(mux, huma.DefaultConfig("Wildfire Monitor API", "1.0.0"))

	huma.Get(api, "/api/fires", getFiresHandler,
		func(o *huma.Operation) {
			o.Summary = "Get fire locations with optional filters"
			o.Description = "Returns GeoJSON FeatureCollection of active fires in Chile. Supports filtering by source, confidence, FRP, day/night, and region."
			o.Tags = []string{"fires"}
		},
	)

	huma.Get(api, "/api/health", getHealthHandler,
		func(o *huma.Operation) {
			o.Summary = "Health check"
			o.Description = "Returns API health status, cache info, and source statistics"
			o.Tags = []string{"system"}
		},
	)

	huma.Get(api, "/api/regions", getRegionsHandler,
		func(o *huma.Operation) {
			o.Summary = "Get Chilean regions"
			o.Description = "Returns list of Chilean region codes and names for filtering"
			o.Tags = []string{"metadata"}
		},
	)

	// Non-Huma handlers for special cases
	mux.HandleFunc("/api/export", exportHandler)
	mux.HandleFunc("/api/wind", getWindHandler)
	mux.HandleFunc("/api/fwi", getFWIHandler)
	mux.HandleFunc("/api/stats", getStatsHandler)
	mux.HandleFunc("/api/major-fires", getMajorFiresHandler)
	mux.HandleFunc("/ws", wsHandler)

	// Serve static files (frontend) - check if static directory exists
	staticDir := "./static"
	if _, err := os.Stat(staticDir); err == nil {
		log.Println("Serving static files from ./static")
		mux.Handle("/", spaHandler(staticDir))
	}

	handler := corsMiddleware(mux)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	log.Printf("Wildfire Monitor API starting on http://localhost:%s", port)
	log.Printf("WebSocket endpoint: ws://localhost:%s/ws", port)
	log.Printf("Refresh interval: 1 minute")
	log.Printf("Satellite sources: VIIRS NOAA-20, VIIRS Suomi NPP, MODIS")
	log.Printf("Fire Weather Index (FWI): /api/fwi")
	log.Printf("API Docs: http://localhost:%s/docs", port)

	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
