package model_test

import (
	"strings"
	"testing"

	"github.com/Quad4-Software/transcriptasm/internal/model"
)

func TestDefaultCatalog(t *testing.T) {
	t.Parallel()
	c := model.DefaultCatalog()
	if len(c.Models) == 0 {
		t.Fatal("empty catalog")
	}
	def, ok := c.DefaultModel()
	if !ok || !def.Default {
		t.Fatalf("missing default model: %+v", def)
	}
	if def.Engine != model.EngineWhisperCPP {
		t.Fatalf("engine=%s", def.Engine)
	}
	if !strings.HasPrefix(def.Path, "/models/") {
		t.Fatalf("path=%s", def.Path)
	}
	got, ok := c.ByID(def.ID)
	if !ok || got.Path == "" {
		t.Fatalf("by id failed: %+v", got)
	}
	ids := c.IDs()
	if len(ids) != len(c.Models) {
		t.Fatalf("ids len %d", len(ids))
	}
}

func TestByIDMissing(t *testing.T) {
	t.Parallel()
	_, ok := model.DefaultCatalog().ByID("nope")
	if ok {
		t.Fatal("expected miss")
	}
}
