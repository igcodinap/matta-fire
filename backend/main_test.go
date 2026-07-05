package main

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestDetermineCountry(t *testing.T) {
	tests := []struct {
		name       string
		lat        float64
		lon        float64
		regionCode string
		want       string
	}{
		{
			name:       "known Chilean region remains Chile",
			lat:        -34.10748,
			lon:        -70.45908,
			regionCode: "VI",
			want:       "Chile",
		},
		{
			name:       "unknown point east of border is Argentina",
			lat:        -33.34475,
			lon:        -66.44398,
			regionCode: "unknown",
			want:       "Argentina",
		},
		{
			name:       "unknown point outside border model stays outside Chile",
			lat:        -10.0,
			lon:        -70.0,
			regionCode: "unknown",
			want:       "Fuera de Chile",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := determineCountry(tt.lat, tt.lon, tt.regionCode)
			if got != tt.want {
				t.Fatalf("determineCountry(%v, %v, %q) = %q, want %q", tt.lat, tt.lon, tt.regionCode, got, tt.want)
			}
		})
	}
}

func TestParseFIRMSTime(t *testing.T) {
	tests := []struct {
		name      string
		acqDate   string
		acqTime   string
		want      time.Time
		wantExact bool
	}{
		{
			name:      "parses early morning UTC time",
			acqDate:   "2026-01-21",
			acqTime:   "0015",
			want:      time.Date(2026, 1, 21, 0, 15, 0, 0, time.UTC),
			wantExact: true,
		},
		{
			name:      "parses late night UTC time",
			acqDate:   "2026-01-21",
			acqTime:   "2359",
			want:      time.Date(2026, 1, 21, 23, 59, 0, 0, time.UTC),
			wantExact: true,
		},
		{
			name:    "handles invalid date",
			acqDate: "invalid",
			acqTime: "0516",
		},
		{
			name:    "handles invalid time",
			acqDate: "2026-01-21",
			acqTime: "2460",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			before := time.Now().UTC().Add(-time.Second)
			unix, observedAt := parseFIRMSTime(tt.acqDate, tt.acqTime)
			after := time.Now().UTC().Add(time.Second)

			if observedAt.IsZero() {
				t.Fatal("expected non-zero ObservedAt time")
			}
			if unix != observedAt.Unix() {
				t.Fatalf("Unix timestamp (%d) should match ObservedAt.Unix() (%d)", unix, observedAt.Unix())
			}
			if observedAt.Location() != time.UTC {
				t.Fatalf("ObservedAt location = %v, want UTC", observedAt.Location())
			}
			if tt.wantExact {
				if !observedAt.Equal(tt.want) {
					t.Fatalf("ObservedAt = %s, want %s", observedAt.Format(time.RFC3339), tt.want.Format(time.RFC3339))
				}
				return
			}
			if observedAt.Before(before) || observedAt.After(after) {
				t.Fatalf("invalid input fallback = %s, want current UTC time between %s and %s", observedAt, before, after)
			}
		})
	}
}

func TestFilterFeaturesByTimestamp(t *testing.T) {
	now := time.Now().Unix()
	features := []Feature{
		{
			Properties: Properties{Timestamp: now - 3600, Country: "Chile"},
		},
		{
			Properties: Properties{Timestamp: now, Country: "Chile"},
		},
		{
			Properties: Properties{Timestamp: now + 3600, Country: "Chile"},
		},
		{
			Properties: Properties{Timestamp: now, Country: "Argentina"},
		},
	}

	tests := []struct {
		name      string
		input     *FiresInput
		wantCount int
	}{
		{
			name:      "filters by from_ts",
			input:     &FiresInput{FromTS: now - 1800},
			wantCount: 3,
		},
		{
			name:      "filters by to_ts",
			input:     &FiresInput{ToTS: now},
			wantCount: 3,
		},
		{
			name:      "filters by from_ts and to_ts",
			input:     &FiresInput{FromTS: now - 1800, ToTS: now},
			wantCount: 2,
		},
		{
			name:      "filters by chile_only true",
			input:     &FiresInput{ChileOnly: true},
			wantCount: 3,
		},
		{
			name:      "no filters returns all",
			input:     &FiresInput{},
			wantCount: 4,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filtered := filterFeatures(features, tt.input)
			if len(filtered) != tt.wantCount {
				t.Fatalf("filterFeatures() returned %d, want %d", len(filtered), tt.wantCount)
			}
		})
	}
}

func TestFilterFeaturesByRegionAndFRP(t *testing.T) {
	features := []Feature{
		{
			Properties: Properties{Region: "RM", FRP: 10, Country: "Chile", Intensity: "low"},
		},
		{
			Properties: Properties{Region: "VIII", FRP: 50, Country: "Chile", Intensity: "high"},
		},
		{
			Properties: Properties{Region: "IX", FRP: 150, Country: "Chile", Intensity: "extreme"},
		},
	}

	tests := []struct {
		name      string
		input     *FiresInput
		wantCount int
	}{
		{
			name:      "filters by region RM",
			input:     &FiresInput{Region: "RM"},
			wantCount: 1,
		},
		{
			name:      "filters by minFRP",
			input:     &FiresInput{MinFRP: 50},
			wantCount: 2,
		},
		{
			name:      "filters by maxFRP",
			input:     &FiresInput{MaxFRP: 20},
			wantCount: 1,
		},
		{
			name:      "filters by intensity",
			input:     &FiresInput{Intensity: "high"},
			wantCount: 1,
		},
		{
			name:      "filters by region and FRP",
			input:     &FiresInput{Region: "VIII", MinFRP: 30},
			wantCount: 1,
		},
		{
			name:      "region not found returns empty",
			input:     &FiresInput{Region: "XV"},
			wantCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filtered := filterFeatures(features, tt.input)
			if len(filtered) != tt.wantCount {
				t.Fatalf("filterFeatures() returned %d, want %d", len(filtered), tt.wantCount)
			}
		})
	}
}

func TestExportMatchesFiresFilters(t *testing.T) {
	now := time.Date(2026, 1, 21, 12, 0, 0, 0, time.UTC).Unix()
	features := []Feature{
		testFeature("match", "Chile", "VIII", "high", "VIIRS NOAA-20", "h", "D", now, 50),
		testFeature("wrong-country", "Argentina", "VIII", "high", "VIIRS NOAA-20", "h", "D", now, 50),
		testFeature("too-old", "Chile", "VIII", "high", "VIIRS NOAA-20", "h", "D", now-7200, 50),
		testFeature("wrong-region", "Chile", "RM", "high", "VIIRS NOAA-20", "h", "D", now, 50),
		testFeature("too-intense", "Chile", "VIII", "extreme", "VIIRS NOAA-20", "h", "D", now, 150),
		testFeature("wrong-intensity", "Chile", "VIII", "medium", "VIIRS NOAA-20", "h", "D", now, 30),
		testFeature("wrong-source", "Chile", "VIII", "high", "MODIS", "h", "D", now, 50),
		testFeature("wrong-confidence", "Chile", "VIII", "high", "VIIRS NOAA-20", "n", "D", now, 50),
		testFeature("wrong-daynight", "Chile", "VIII", "high", "VIIRS NOAA-20", "h", "N", now, 50),
	}

	cache.Set(FeatureCollection{
		Type:     "FeatureCollection",
		Features: features,
		Metadata: &Metadata{
			TotalCount: len(features),
			Sources:    []string{"VIIRS NOAA-20", "MODIS"},
			FetchedAt:  time.Date(2026, 1, 21, 12, 5, 0, 0, time.UTC),
		},
	}, map[string]int{"VIIRS NOAA-20": len(features)})

	input := &FiresInput{
		Source:     "NOAA-20",
		Confidence: "high",
		Intensity:  "high",
		MinFRP:     40,
		MaxFRP:     100,
		DayNight:   "D",
		Region:     "VIII",
		FromTS:     now - 1800,
		ToTS:       now + 1800,
		ChileOnly:  true,
	}

	firesOutput, err := getFiresHandler(context.Background(), input)
	if err != nil {
		t.Fatalf("getFiresHandler returned error: %v", err)
	}
	if got := len(firesOutput.Body.Features); got != 1 {
		t.Fatalf("/api/fires equivalent returned %d features, want 1", got)
	}
	if got := firesOutput.Body.Features[0].Properties.GridID; got != "match" {
		t.Fatalf("/api/fires equivalent returned %q, want match", got)
	}
	if firesOutput.Body.Metadata == nil || firesOutput.Body.Metadata.TotalCount != 1 {
		t.Fatalf("/api/fires metadata total count = %#v, want 1", firesOutput.Body.Metadata)
	}

	cached, _ := cache.Get()
	if cached.Metadata == nil || cached.Metadata.TotalCount != len(features) {
		t.Fatalf("getFiresHandler mutated cached metadata total count = %#v, want %d", cached.Metadata, len(features))
	}

	query := "?format=geojson&source=NOAA-20&confidence=high&intensity=high&min_frp=40&max_frp=100&daynight=D&region=VIII&from_ts=" +
		strconvFormatInt(now-1800) + "&to_ts=" + strconvFormatInt(now+1800) + "&chile_only=true"
	req := httptest.NewRequest("GET", "/api/export"+query, nil)
	rec := httptest.NewRecorder()
	exportHandler(rec, req)

	var exported FeatureCollection
	if err := json.NewDecoder(rec.Body).Decode(&exported); err != nil {
		t.Fatalf("failed to decode GeoJSON export: %v", err)
	}
	if got := len(exported.Features); got != len(firesOutput.Body.Features) {
		t.Fatalf("/api/export returned %d features, /api/fires returned %d", got, len(firesOutput.Body.Features))
	}
	if got := exported.Features[0].Properties.GridID; got != firesOutput.Body.Features[0].Properties.GridID {
		t.Fatalf("/api/export returned %q, /api/fires returned %q", got, firesOutput.Body.Features[0].Properties.GridID)
	}
	if exported.Metadata == nil || exported.Metadata.TotalCount != 1 {
		t.Fatalf("/api/export metadata total count = %#v, want 1", exported.Metadata)
	}
}

func TestCSVExportHonorsFilters(t *testing.T) {
	now := time.Date(2026, 1, 21, 12, 0, 0, 0, time.UTC).Unix()
	cache.Set(FeatureCollection{
		Type: "FeatureCollection",
		Features: []Feature{
			testFeature("match", "Chile", "VIII", "high", "VIIRS NOAA-20", "h", "D", now, 50),
			testFeature("wrong-intensity", "Chile", "VIII", "medium", "VIIRS NOAA-20", "h", "D", now, 30),
		},
		Metadata: &Metadata{
			TotalCount:   2,
			FetchedAt:    time.Date(2026, 1, 21, 12, 5, 0, 0, time.UTC),
			SourceNotice: "test notice",
		},
	}, map[string]int{"VIIRS NOAA-20": 2})

	req := httptest.NewRequest("GET", "/api/export?format=csv&intensity=high&chile_only=true", nil)
	rec := httptest.NewRecorder()
	exportHandler(rec, req)

	rows, err := csv.NewReader(strings.NewReader(rec.Body.String())).ReadAll()
	if err != nil {
		t.Fatalf("failed to read CSV export: %v", err)
	}
	if got := len(rows); got != 2 {
		t.Fatalf("CSV row count = %d, want header + one data row", got)
	}
	if got := rows[1][14]; got != "high" {
		t.Fatalf("CSV intensity column = %q, want high", got)
	}
	if got := rows[1][20]; got != "test notice" {
		t.Fatalf("CSV source_notice column = %q, want test notice", got)
	}
}

func TestFireHistoryDeduplicatesRepeatedObservation(t *testing.T) {
	history := &FireHistory{fires: make(map[string]*FireRecord)}
	observedAt := time.Date(2026, 1, 21, 12, 30, 0, 0, time.UTC)

	first := history.AddDetection(-37.123, -72.456, 60, "VIII", "VIIRS NOAA-20", "2026-01-21", "1230", observedAt, 18, 210)
	if first.DetectionCount != 1 {
		t.Fatalf("first detection count = %d, want 1", first.DetectionCount)
	}

	repeated := history.AddDetection(-37.123, -72.456, 60, "VIII", "VIIRS NOAA-20", "2026-01-21", "1230", observedAt, 18, 210)
	if repeated.DetectionCount != 1 {
		t.Fatalf("repeated observation count = %d, want 1", repeated.DetectionCount)
	}
	if !repeated.FirstSeen.Equal(observedAt) || !repeated.LastSeen.Equal(observedAt) {
		t.Fatalf("repeated observation changed seen bounds: first=%s last=%s", repeated.FirstSeen, repeated.LastSeen)
	}

	laterObservedAt := observedAt.Add(30 * time.Minute)
	later := history.AddDetection(-37.124, -72.457, 80, "VIII", "VIIRS NOAA-20", "2026-01-21", "1300", laterObservedAt, 22, 220)
	if later.DetectionCount != 2 {
		t.Fatalf("new acquisition count = %d, want 2", later.DetectionCount)
	}
	if !later.FirstSeen.Equal(observedAt) || !later.LastSeen.Equal(laterObservedAt) {
		t.Fatalf("new acquisition seen bounds: first=%s last=%s", later.FirstSeen, later.LastSeen)
	}
}

func TestFetchFIRMSDataPreservesCacheOnTotalFailure(t *testing.T) {
	oldCache := cache
	oldFetch := fetchFromSourceFunc
	defer func() {
		cache = oldCache
		fetchFromSourceFunc = oldFetch
	}()

	cache = &FireCache{
		data: FeatureCollection{
			Type:     "FeatureCollection",
			Features: []Feature{},
		},
		sourceCount: make(map[string]int),
	}

	previous := FeatureCollection{
		Type: "FeatureCollection",
		Features: []Feature{
			testFeature("existing", "Chile", "VIII", "high", "VIIRS NOAA-20", "h", "D", time.Date(2026, 1, 21, 12, 0, 0, 0, time.UTC).Unix(), 50),
		},
	}
	cache.Set(previous, map[string]int{"VIIRS NOAA-20": 1})

	t.Setenv("NASA_FIRMS_API_KEY", "test-key")
	fetchFromSourceFunc = func(url, sourceName string) ([]Feature, error) {
		return nil, errors.New("upstream down")
	}

	if err := fetchFIRMSData(); err == nil {
		t.Fatal("fetchFIRMSData returned nil error, want total outage error")
	}

	got, _ := cache.Get()
	if len(got.Features) != 1 || got.Features[0].Properties.GridID != "existing" {
		t.Fatalf("cache was not preserved after total outage: %#v", got.Features)
	}

	health, err := getHealthHandler(context.Background(), &struct{}{})
	if err != nil {
		t.Fatalf("getHealthHandler returned error: %v", err)
	}
	if health.Body.Status != "degraded" {
		t.Fatalf("health status = %q, want degraded", health.Body.Status)
	}
	if health.Body.LastError == "" {
		t.Fatal("health last_error is empty after total outage")
	}
}

func TestCoordinateHandlersRejectInvalidCoordinates(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		handle func(http.ResponseWriter, *http.Request)
	}{
		{
			name:   "fwi invalid lat",
			path:   "/api/fwi?lat=bad&lon=-70.65",
			handle: getFWIHandler,
		},
		{
			name:   "fwi missing lon",
			path:   "/api/fwi?lat=-33.45",
			handle: getFWIHandler,
		},
		{
			name:   "wind out of range lat",
			path:   "/api/wind?lat=-999&lon=-70.65",
			handle: getWindHandler,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			rec := httptest.NewRecorder()
			tt.handle(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("%s status = %d, want %d; body=%s", tt.path, rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}
}

func testFeature(gridID, country, region, intensity, satellite, confidence, daynight string, timestamp int64, frp float64) Feature {
	return Feature{
		Type: "Feature",
		Geometry: Geometry{
			Type:        "Point",
			Coordinates: []float64{-72.0, -37.0},
		},
		Properties: Properties{
			GridID:     gridID,
			Country:    country,
			Region:     region,
			Intensity:  intensity,
			Satellite:  satellite,
			Confidence: confidence,
			DayNight:   daynight,
			Timestamp:  timestamp,
			FRP:        frp,
			ObservedAt: time.Unix(timestamp, 0).UTC(),
		},
	}
}

func strconvFormatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}
