FROM node:20-slim AS builder

# Install build dependencies for whisper.cpp
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    curl \
    gcc-12 \
    g++-12 \
    && rm -rf /var/lib/apt/lists/*

# Clone and build whisper.cpp with static linking
WORKDIR /tmp/whisper-build
RUN git clone https://github.com/ggerganov/whisper.cpp.git . && \
    mkdir build && \
    cd build && \
    cmake -DBUILD_SHARED_LIBS=OFF .. && \
    cmake --build . --config Release && \
    mkdir -p /app/whisper.cpp/build/bin/Release && \
    if [ -f bin/Release/whisper-cli ]; then cp bin/Release/whisper-cli /app/whisper.cpp/build/bin/Release/; else cp bin/whisper-cli /app/whisper.cpp/build/bin/Release/; fi && \
    chmod +x /app/whisper.cpp/build/bin/Release/whisper-cli

# Download Whisper model (base model ~140MB)
WORKDIR /app/whisper.cpp
RUN curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o ggml-base.bin

# ──── Runtime Stage ────
FROM node:20-slim

WORKDIR /app

# Install runtime dependencies for audio processing
# Including libopus for WebM/Opus audio decoding and ffmpeg-full with all codecs
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libopus0 \
    libopusfile0 \
    libvorbis0a \
    libvorbisfile3 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy whisper.cpp build from builder
COPY --from=builder /app/whisper.cpp /app/whisper.cpp

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm ci --production

# Copy application code
COPY . .

# Expose the API port
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
