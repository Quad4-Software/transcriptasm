# transcriptasm

Offline speech-to-text in the browser via Whisper WASM. Nothing is uploaded.

**Live:** [https://transcriptasm.quad4.io](https://transcriptasm.quad4.io)

Whisper model weights (`web/models/*.bin`, ~88MB) are **not** in git. Docker and Pages fetch them at build time. For a local source build, run `make assets` once.

## Install (Docker)

```bash
git clone git@github.com:Quad4-Software/transcriptasm.git
cd transcriptasm
docker compose up --build
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080).

Coolify: use `docker-compose.coolify.yml` and set the domain to container port `8080`.

## Build from source

Needs Go 1.26+ and Node (for tests).

```bash
git clone git@github.com:Quad4-Software/transcriptasm.git
cd transcriptasm
make assets
make build
make run
```

```bash
make test
make check
```

Binary: `bin/transcriptasm` (default listen `:8080`, web root `web`).

## License

MIT
