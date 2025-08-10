# Rollout Dashboard

A web application with a Go Gin backend and Svelte frontend.

## Project Structure

```
.
├── frontend/          # Svelte frontend
├── main.go           # Go backend entry point
└── go.mod            # Go module file
```

## Setup Instructions

### Backend (Go)

1. Install Go dependencies:
```bash
go mod tidy
```

2. Run the backend server:
```bash
go run main.go
```

The backend server will run on http://localhost:8080

### Frontend (Svelte)

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Run the development server:
```bash
npm run dev
```

The frontend development server will run on http://localhost:5173

## Building for Production

1. Build the frontend:
```bash
cd frontend
npm run build
```

2. The built files will be in `frontend/dist` and will be served by the Go backend.

## API Endpoints

- `GET /api/health` - Health check endpoint
