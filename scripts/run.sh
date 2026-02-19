#!/bin/bash
# Stop existing processes on 3000 and 3001
echo "Stopping existing processes..."
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
sleep 2

echo "Starting IM backend + Next.js frontend..."
cd "$(dirname "$0")/.." && npm run dev
