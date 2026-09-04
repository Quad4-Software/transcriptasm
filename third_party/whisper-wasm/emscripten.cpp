#include "whisper.h"

#include <emscripten.h>
#include <emscripten/bind.h>

#include <algorithm>
#include <string>
#include <thread>
#include <vector>

std::thread g_worker;
std::vector<struct whisper_context *> g_contexts(4, nullptr);
volatile bool g_busy = false;

static inline int mpow2(int n) {
	int p = 1;
	while (p <= n) {
		p *= 2;
	}
	return p / 2;
}

static inline int pick_threads(int requested) {
	const int hw = std::max(1, (int)std::thread::hardware_concurrency());
	const int want = requested > 0 ? requested : hw;
	return std::max(1, std::min({want, hw, 8, mpow2(hw)}));
}

EMSCRIPTEN_BINDINGS(whisper) {
	emscripten::function("init", emscripten::optional_override([](const std::string & path_model) {
		if (g_worker.joinable()) {
			g_worker.join();
		}

		for (size_t i = 0; i < g_contexts.size(); ++i) {
			if (g_contexts[i] == nullptr) {
				struct whisper_context_params cparams = whisper_context_default_params();
				cparams.flash_attn = true;
				g_contexts[i] = whisper_init_from_file_with_params(path_model.c_str(), cparams);
				if (g_contexts[i] != nullptr) {
					return i + 1;
				}
				return (size_t)0;
			}
		}

		return (size_t)0;
	}));

	emscripten::function("free", emscripten::optional_override([](size_t index) {
		if (g_worker.joinable()) {
			g_worker.join();
		}

		--index;
		if (index < g_contexts.size()) {
			whisper_free(g_contexts[index]);
			g_contexts[index] = nullptr;
		}
	}));

	emscripten::function("is_busy", emscripten::optional_override([]() {
		return g_busy;
	}));

	emscripten::function("full_default", emscripten::optional_override([](
		size_t index,
		const emscripten::val & audio,
		const std::string & lang,
		int nthreads,
		bool translate) {
		if (g_worker.joinable()) {
			g_worker.join();
		}

		--index;
		if (index >= g_contexts.size()) {
			return -1;
		}
		if (g_contexts[index] == nullptr) {
			return -2;
		}
		if (g_busy) {
			return -3;
		}

		struct whisper_full_params params = whisper_full_default_params(whisper_sampling_strategy::WHISPER_SAMPLING_GREEDY);
		const bool is_multilingual = whisper_is_multilingual(g_contexts[index]);

		params.print_realtime = false;
		params.print_progress = false;
		params.print_timestamps = false;
		params.print_special = false;
		params.translate = translate;
		params.language = is_multilingual ? strdup(lang.c_str()) : "en";
		params.n_threads = pick_threads(nthreads);
		params.offset_ms = 0;
		params.no_context = true;
		params.single_segment = false;
		params.no_timestamps = false;
		params.token_timestamps = false;
		params.suppress_blank = true;
		params.suppress_nst = false;
		params.temperature = 0.0f;
		// Keep fallback so stuck greedy loops (foam foam foam) can recover.
		params.temperature_inc = 0.2f;
		params.entropy_thold = 2.4f;
		params.logprob_thold = -1.0f;
		params.no_speech_thold = 0.6f;
		params.max_len = 0;
		params.audio_ctx = 0;

		std::vector<float> pcmf32;
		const int n = audio["length"].as<int>();
		pcmf32.resize(n);

		emscripten::val heap = emscripten::val::module_property("HEAPU8");
		emscripten::val memory = heap["buffer"];
		emscripten::val memoryView = audio["constructor"].new_(memory, reinterpret_cast<uintptr_t>(pcmf32.data()), n);
		memoryView.call<void>("set", audio);

		g_busy = true;
		g_worker = std::thread([index, params, pcmf32 = std::move(pcmf32), is_multilingual]() mutable {
			whisper_reset_timings(g_contexts[index]);
			whisper_full(g_contexts[index], params, pcmf32.data(), int(pcmf32.size()));
			whisper_print_timings(g_contexts[index]);
			if (is_multilingual) {
				free((void *)params.language);
			}
			g_busy = false;
		});

		return 0;
	}));

	emscripten::function("get_text", emscripten::optional_override([](size_t index) {
		--index;
		if (index >= g_contexts.size() || g_contexts[index] == nullptr) {
			return std::string();
		}
		std::string out;
		const int n = whisper_full_n_segments(g_contexts[index]);
		for (int i = 0; i < n; ++i) {
			const char * txt = whisper_full_get_segment_text(g_contexts[index], i);
			if (!txt) {
				continue;
			}
			if (!out.empty()) {
				out += ' ';
			}
			out += txt;
		}
		return out;
	}));

	emscripten::function("get_segment_count", emscripten::optional_override([](size_t index) {
		--index;
		if (index >= g_contexts.size() || g_contexts[index] == nullptr) {
			return 0;
		}
		return whisper_full_n_segments(g_contexts[index]);
	}));

	emscripten::function("get_segment_text", emscripten::optional_override([](size_t index, int iseg) {
		--index;
		if (index >= g_contexts.size() || g_contexts[index] == nullptr) {
			return std::string();
		}
		const char * txt = whisper_full_get_segment_text(g_contexts[index], iseg);
		return txt ? std::string(txt) : std::string();
	}));

	emscripten::function("get_segment_t0", emscripten::optional_override([](size_t index, int iseg) {
		--index;
		if (index >= g_contexts.size() || g_contexts[index] == nullptr) {
			return 0;
		}
		return int(whisper_full_get_segment_t0(g_contexts[index], iseg));
	}));

	emscripten::function("get_segment_t1", emscripten::optional_override([](size_t index, int iseg) {
		--index;
		if (index >= g_contexts.size() || g_contexts[index] == nullptr) {
			return 0;
		}
		return int(whisper_full_get_segment_t1(g_contexts[index], iseg));
	}));
}
