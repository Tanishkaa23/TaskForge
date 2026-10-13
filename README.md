# TaskForge — AI-Powered Background Job Processing System

TaskForge is a backend application that processes AI-powered tasks asynchronously using Node.js, Express.js, BullMQ, Redis, MongoDB, and the Groq API.

Instead of keeping an API request waiting for AI processing to finish, TaskForge queues the task and lets a separate worker process it in the background. The application stores job status and results in MongoDB so clients can check progress later.

## Features

- **Asynchronous job processing:** Submit tasks without waiting for AI processing to finish.
- **AI-powered text summarization:** Generate summaries using the Groq API.
- **Background workers:** Process queued jobs independently of the API server.
- **Retry mechanism:** Retry failed jobs up to three attempts with exponential backoff.
- **Job status tracking:** Track jobs through `queued`, `processing`, `completed`, and `failed` states.
- **Idempotent requests:** Reuse existing jobs when the same idempotency key and request payload are submitted again.
- **Job recovery:** Attempt to restore queued database jobs whose corresponding BullMQ queue entries are missing when the worker starts.
- **REST API:** Submit jobs, retrieve individual jobs, and list jobs with pagination and status filtering.
- **Docker Compose:** Run the API, worker, MongoDB, and Redis as separate services.
- **API protection:** Request validation, payload size limits, and rate limiting for job submissions.

## Tech Stack

- **Runtime:** Node.js
- **API:** Express.js
- **Database:** MongoDB with Mongoose
- **Queue:** BullMQ
- **Queue storage:** Redis
- **AI:** Groq API
- **Containerization:** Docker and Docker Compose

## Architecture

```text
Client
  |
  | POST /api/jobs
  v
Express API
  |
  | Save job
  v
MongoDB
  |
  | Enqueue task
  v
BullMQ + Redis
  |
  | Worker fetches job
  v
Background Worker
  |
  | Generate summary
  v
Groq API
  |
  | Save result and status
  v
MongoDB
  |
  | GET /api/jobs/:id
  v
Client
```

The API and worker run independently. The API handles incoming requests and job submission, while the worker performs AI processing and updates the job record.

## Getting Started

### Prerequisites

- Node.js and npm
- Docker Desktop with Docker Compose
- A Groq API key

### Installation

1. Clone the repository.

```bash
git clone <your-github-repository-url>
cd TaskForge/server
```

2. Create a `.env` file in the `server` directory.

```env
PORT=5000
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-20b
```

Add any other environment variables required by your application's existing configuration. Never commit `.env` or API secrets to Git.

3. Build and start the services.

```bash
docker compose up -d --build
```

4. Check the service status.

```bash
docker compose ps
```

5. View API and worker logs.

```bash
docker compose logs -f api
```

In another terminal:

```bash
docker compose logs -f worker
```

The API should be available at `http://localhost:5000`.

## API Endpoints

### 1. Submit a job

**POST** `/api/jobs`

Request body:

```json
{
  "type": "summarize",
  "payload": {
    "text": "Redis and BullMQ help applications process background tasks asynchronously."
  }
}
```

Example response fields:

```json
{
  "jobId": "<mongodb-job-id>",
  "queueJobId": "<bullmq-job-id>"
}
```

The endpoint returns HTTP `202 Accepted` when a job is submitted successfully.

You can optionally send an `Idempotency-Key` header to prevent repeated submissions of the same request.

```text
Idempotency-Key: summarize-request-001
```

Reusing the key with the same request returns the existing job. Reusing it with a different request payload returns a conflict response.

### 2. Get a job by ID

**GET** `/api/jobs/:id`

Example:

```text
GET /api/jobs/<mongodb-job-id>
```

Returns the job's ID, queue ID, type, status, payload, result, error, and timestamps.

### 3. List jobs

**GET** `/api/jobs?page=1&limit=5`

Returns a paginated list of jobs.

### 4. Filter jobs by status

**GET** `/api/jobs?status=completed&page=1&limit=5`

Filters jobs by status. Supported statuses are:

- `queued`
- `processing`
- `completed`
- `failed`

## Job Processing Lifecycle

1. The client submits a summarization request.
2. The API validates the payload and creates a MongoDB job record.
3. The API adds a task to the BullMQ queue stored in Redis.
4. The worker retrieves the task.
5. The worker requests a summary from the Groq API.
6. The worker stores the result and updates the MongoDB job status.
7. The client retrieves the completed result through the job status endpoint.

## Retry and Recovery

### Retries

Jobs are configured for up to three processing attempts, with exponential backoff starting at two seconds. The worker updates job status and error information as processing progresses.

### Recovery

On startup, the worker checks MongoDB for jobs marked `queued`. If the corresponding BullMQ entry cannot be found, it attempts to enqueue the job again using a stable job ID.

This is a basic recovery mechanism. It is not a guarantee of exactly-once processing, and further safeguards are needed for concurrency races and consistency between MongoDB and Redis.

## Running Tests Manually

Submit a summarization job:

```powershell
$body = @{
  type = "summarize"
  payload = @{
    text = "TaskForge processes AI tasks asynchronously."
  }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod `
  -Uri "http://localhost:5000/api/jobs" `
  -Method Post `
  -ContentType "application/json" `
  -Body $body
```

Use the returned MongoDB job ID to check the result:

```powershell
Invoke-RestMethod `
  -Uri "http://localhost:5000/api/jobs/<mongodb-job-id>" `
  -Method Get
```

## Future Improvements

- Automated integration tests
- More robust recovery and concurrency controls
- Authentication and authorization
- Structured logging and monitoring
- Deployment to AWS
- CI/CD pipeline

## License

Add a license appropriate for your project before distributing it publicly.