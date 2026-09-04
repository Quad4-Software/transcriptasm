// Package model describes Whisper-family models served from local disk.
package model

import "slices"

// Engine identifies a browser transcription backend.
type Engine string

const (
	// EngineWhisperCPP runs the vendored whisper.cpp single-file WASM build.
	EngineWhisperCPP Engine = "whisper-cpp"
	// EngineAuto prefers WebGPU (transformers.js) and falls back to whisper.cpp WASM.
	EngineAuto Engine = "auto"
)

// Model is a selectable transcription model.
type Model struct {
	ID           string  `json:"id"`
	Label        string  `json:"label"`
	Engine       Engine  `json:"engine"`
	Path         string  `json:"path"`
	OnnxID       string  `json:"onnx_id,omitempty"`
	OnnxPath     string  `json:"onnx_path,omitempty"`
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

// DefaultCatalog returns built-in local ggml + ONNX models (no network).
func DefaultCatalog() Catalog {
	return Catalog{
		Models: []Model{
			{
				ID:           "tiny.en-q5_1",
				Label:        "Quick",
				Engine:       EngineAuto,
				Path:         "/models/ggml-tiny.en-q5_1.bin",
				OnnxID:       "whisper-tiny.en",
				OnnxPath:     "/models/onnx/whisper-tiny.en",
				Language:     "en",
				SizeHintMB:   120,
				SpeedRank:    5,
				AccuracyRank: 2,
				Default:      true,
				Notes:        "Fastest. WebGPU when available, WASM fallback.",
			},
			{
				ID:           "base.en-q5_1",
				Label:        "Clearer",
				Engine:       EngineAuto,
				Path:         "/models/ggml-base.en-q5_1.bin",
				OnnxID:       "whisper-base.en",
				OnnxPath:     "/models/onnx/whisper-base.en",
				Language:     "en",
				SizeHintMB:   206,
				SpeedRank:    3,
				AccuracyRank: 4,
				Notes:        "A bit slower. Catches more detail.",
			},
			{
				ID:           "tiny-q5_1",
				Label:        "Quick (any language)",
				Engine:       EngineAuto,
				Path:         "/models/ggml-tiny-q5_1.bin",
				OnnxID:       "whisper-tiny",
				OnnxPath:     "/models/onnx/whisper-tiny",
				Language:     "auto",
				SizeHintMB:   120,
				SpeedRank:    5,
				AccuracyRank: 2,
				Optional:     true,
				Multilingual: true,
				Notes:        "Fast multilingual. Use with Translate for English text.",
			},
			{
				ID:           "base-q5_1",
				Label:        "Clearer (any language)",
				Engine:       EngineAuto,
				Path:         "/models/ggml-base-q5_1.bin",
				OnnxID:       "whisper-base",
				OnnxPath:     "/models/onnx/whisper-base",
				Language:     "auto",
				SizeHintMB:   206,
				SpeedRank:    3,
				AccuracyRank: 4,
				Optional:     true,
				Multilingual: true,
				Notes:        "Clearer multilingual. Use with Translate for English text.",
			},
			{
				ID:           "small.en-q5_1",
				Label:        "Best",
				Engine:       EngineAuto,
				Path:         "/models/ggml-small.en-q5_1.bin",
				OnnxID:       "whisper-small.en",
				OnnxPath:     "/models/onnx/whisper-small.en",
				Language:     "en",
				SizeHintMB:   586,
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
