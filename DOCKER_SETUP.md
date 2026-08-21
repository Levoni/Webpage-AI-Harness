# Voice AI Chat - Docker Setup

This Docker Compose setup orchestrates both the Node.js API and the web interface for the Voice AI Chat application.

## Prerequisites

- Docker and Docker Compose installed
- Environment variables configured (see below)

## Architecture

- **API Service** (port 3000): Node.js Express server handling transcription, LLM processing, and text-to-speech
- **Web Service** (port 80): Nginx server serving the HTML interface and proxying API requests

## Setup Instructions

### 1. Configure Environment Variables

Copy `.env.example` to `.env` and update with your configuration:

```bash
cp .env.example .env
```

Edit `.env` with your values:
- `HA_URL`: Your Home Assistant instance URL
- `HA_TOKEN`: Your Home Assistant token
- `OLLAMA_URL`: URL to your Ollama instance (defaults to `http://host.docker.internal:11434` for Docker Desktop)

### 2. Build and Start Services

```bash
docker-compose up --build
```

Or in detached mode:

```bash
docker-compose up -d --build
```

### 3. Access the Application

- **Web Interface**: http://localhost
- **API Endpoint**: http://localhost/transcribe

## Services

### API Service
- Transcribes audio using Whisper
- Processes text with Ollama LLM
- Converts responses to speech using Kokoro
- Handles Home Assistant automation commands

**Includes:**
- Whisper.cpp automatically built during image creation
- Base Whisper model (~140MB) pre-downloaded
- ffmpeg for audio processing

**Requires:**
- Ollama running and accessible
- Home Assistant instance with token

### Web Service
- Serves HTML interface
- Proxies `/transcribe` requests to the API
- Provides WebSocket proxy for real-time communication

## Common Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f api
docker-compose logs -f web

# Rebuild containers
docker-compose up -d --build

# Remove volumes (data loss!)
docker-compose down -v
```

## Networking

Both services communicate on the `voice-ai` bridge network. The web service proxies requests to the API internally using the service name `api:3000`.

## Troubleshooting

### Docker image build is slow
- Building whisper.cpp from source takes 5-15 minutes depending on your system
- The base model download adds another 1-2 minutes
- Subsequent builds will use Docker's layer caching, making them faster

### API not starting
- Check logs: `docker-compose logs api`
- Ensure Ollama is running and accessible at the configured URL
- Verify Home Assistant credentials in `.env`
- The first run may take longer as whisper.cpp is compiled

### Web interface not loading
- Check logs: `docker-compose logs web`
- Ensure port 80 is not in use
- Verify API service is running

### WebSocket connection issues
- The nginx configuration includes WebSocket support
- Check browser console for connection errors

## Notes

- Audio uploads are limited to 10MB
- Temporary files are stored in `/tmp/whisper-work` volume
- Whisper.cpp is automatically compiled during Docker build (no external binary needed)
- The base Whisper model is downloaded during build (~140MB)
- For macOS/Windows Docker Desktop, use `http://host.docker.internal:11434` for host services
- To use a different Whisper model, add `WHISPER_MODEL` volume mount or modify the Dockerfile
