// Package model describes Whisper-family models served from local disk.
package model

import "slices"

// Engine identifies a browser transcription backend.
type Engine string

const (
	// EngineWhisperCPP runs the vendored whisper.cpp single-file WASM build.
	EngineWhisperCPP Engine = "whisper-cpp"
)

// Model is a selectable transcription model.
type Model struct {
	ID           string  `json:"id"`
	Label        string  `json:"label"`
	Engine       Engine  `json:"engine"`
	Path         string  `json:"path"`
	Language     string  `json:"language"`
	SizeHintMB   float64 `json:"size_hint_mb"`
	SpeedRank    int     `json:"speed_rank"`
	AccuracyRank int     `json:"accuracy_rank"`
	Default      bool    `json:"default,omitempty"`
	Optional     bool    `json:"optional,omitempty"`
	Multilingual bool    `json:"multilingual,omitempty"`
	Notes        string  `json:"notes,omitempty"`
}

// Catalog is the ordered list of models exposed by the API.
type Catalog struct {
	Models []Model `json:"models"`
}

// DefaultCatalog returns built-in local ggml models (no network).
func DefaultCatalog() Catalog {
	return Catalog{
		Models: []Model{
			{
				ID:           "tiny.en-q5_1",
				Label:        "Quick",
				Engine:       EngineWhisperCPP,
				Path:         "/models/ggml-tiny.en-q5_1.bin",
				Language:     "en",
				SizeHintMB:   31,
				SpeedRank:    5,
				AccuracyRank: 2,
				Default:      true,
				Notes:        "Fastest. Great for everyday notes.",
			},
			{
				ID:           "base.en-q5_1",
				Label:        "Clearer",
				Engine:       EngineWhisperCPP,
				Path:         "/models/ggml-base.en-q5_1.bin",
				Language:     "en",
				SizeHintMB:   57,
				SpeedRank:    3,
				AccuracyRank: 4,
				Notes:        "A bit slower. Catches more detail.",
			},
			{
				ID:           "tiny-q5_1",
				Label:        "Quick (any language)",
				Engine:       EngineWhisperCPP,
				Path:         "/models/ggml-tiny-q5_1.bin",
				Language:     "auto",
				SizeHintMB:   31,
				SpeedRank:    5,
				AccuracyRank: 2,
				Optional:     true,
				Multilingual: true,
				Notes:        "Fast multilingual. Use with Translate for English text.",
			},
			{
				ID:           "base-q5_1",
				Label:        "Clearer (any language)",
				Engine:       EngineWhisperCPP,
				Path:         "/models/ggml-base-q5_1.bin",
				Language:     "auto",
				SizeHintMB:   57,
				SpeedRank:    3,
				AccuracyRank: 4,
				Optional:     true,
				Multilingual: true,
				Notes:        "Clearer multilingual. Use with Translate for English text.",
			},
			{
				ID:           "small.en-q5_1",
				Label:        "Best",
				Engine:       EngineWhisperCPP,
				Path:         "/models/ggml-small.en-q5_1.bin",
				Language:     "en",
				SizeHintMB:   182,
				SpeedRank:    1,
				AccuracyRank: 5,
				Optional:     true,
				Notes:        "Highest English accuracy. Larger download.",
			},
		},
	}
}

// ByID returns a model or false when unknown.
func (c Catalog) ByID(id string) (Model, bool) {
	for i := range c.Models {
		if c.Models[i].ID == id {
			return c.Models[i], true
		}
	}
	return Model{}, false
}

// DefaultModel returns the catalog default or the first entry.
func (c Catalog) DefaultModel() (Model, bool) {
	for i := range c.Models {
		if c.Models[i].Default {
			return c.Models[i], true
		}
	}
	if len(c.Models) == 0 {
		return Model{}, false
	}
	return c.Models[0], true
}

// IDs returns model identifiers in catalog order.
func (c Catalog) IDs() []string {
	ids := make([]string, 0, len(c.Models))
	for i := range c.Models {
		ids = append(ids, c.Models[i].ID)
	}
	return slices.Clone(ids)
}
