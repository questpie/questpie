# docs

This is a Tanstack Start application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

## Development

Run development server:

```bash
bun run dev
```

## Production Build

Build for production:

```bash
bun run build
```

Start production server:

```bash
bun run start
```

## Docker

### Build Docker Image

```bash
docker build -t questpie-docs .
```

### Run Docker Container

```bash
docker run -p 3000:3000 \
  -e VITE_OPENPANEL_CLIENT_ID=your_client_id_here \
  questpie-docs
```

Or with docker-compose:

```yaml
services:
  docs:
    build: .
    ports:
      - "3000:3000"
    environment:
      - VITE_OPENPANEL_CLIENT_ID=${VITE_OPENPANEL_CLIENT_ID}
    restart: unless-stopped
```

The application will be available at `http://localhost:3000`.

### Health Check

The Docker container includes a health check that pings the server every 30 seconds.

## Analytics

This app uses [OpenPanel](https://openpanel.dev) for analytics tracking.

### Setup

1. Sign up at [openpanel.dev](https://openpanel.dev)
2. Get your client ID from the dashboard
3. Create `.env.local` file:

```bash
VITE_OPENPANEL_CLIENT_ID=your_client_id_here
```

The tracking will automatically be enabled when the environment variable is set. If not set, the app will run without analytics.

### What gets tracked

- Page views (automatically)
- Visit duration
- Outgoing links
- Device and browser information
- User location

Implementation in: `src/routes/__root.tsx`
