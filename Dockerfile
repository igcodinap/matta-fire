# =============================================================================
# Stage 1: Build Frontend
# =============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN npm run build

# =============================================================================
# Stage 2: Build Backend
# =============================================================================
FROM golang:1.22-alpine AS backend-builder

WORKDIR /app

# Install ca-certificates for HTTPS requests
RUN apk add --no-cache ca-certificates

# Copy go mod files
COPY backend/go.mod backend/go.sum ./

# Download dependencies
RUN go mod download

# Copy backend source
COPY backend/*.go ./

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

# =============================================================================
# Stage 3: Final Image
# =============================================================================
FROM alpine:3.19

WORKDIR /app

# Install ca-certificates for HTTPS requests to NASA FIRMS and Open-Meteo
RUN apk add --no-cache ca-certificates tzdata

# Copy binary from builder
COPY --from=backend-builder /app/server .

# Copy frontend build to static directory
COPY --from=frontend-builder /app/frontend/dist ./static

# Expose port (Railway sets PORT env var)
EXPOSE 8081

# Run the server
CMD ["./server"]
