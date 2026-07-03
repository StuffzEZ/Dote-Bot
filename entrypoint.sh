#!/bin/bash
set -e

echo "Starting Whisper ASR server on port 9000..."
cd /whisper
python3 whisper-server.py &
WHISPER_PID=$!

echo "Waiting for Whisper to start..."
sleep 5

echo "Starting Node.js bot..."
cd /app
node src/index.js &
BOT_PID=$!

cleanup() {
    echo "Shutting down..."
    kill $WHISPER_PID 2>/dev/null || true
    kill $BOT_PID 2>/dev/null || true
    wait $WHISPER_PID 2>/dev/null || true
    wait $BOT_PID 2>/dev/null || true
    exit 0
}

trap cleanup SIGTERM SIGINT

wait $WHISPER_PID $BOT_PID
