package main

import "testing"

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
