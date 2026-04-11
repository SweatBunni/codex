# CodexMC v2.0 - Modern Backend with ChatGPT Features

## Overview

CodexMC v2.0 is a complete rewrite of the backend with modern architecture, ChatGPT-like conversation features, and enhanced security. This new version provides a much more user-friendly and maintainable codebase.

## Key Features

### ChatGPT-Like Features
- **Real-time Conversations**: Persistent chat sessions with full history
- **Streaming Responses**: Real-time streaming of AI responses
- **Context Management**: Smart context window management for better AI interactions
- **Message Editing**: Edit and regenerate messages
- **Session Management**: Create, clear, and manage conversation sessions
- **WebSocket Support**: Real-time communication for instant updates

### Enhanced Architecture
- **Modular Design**: Clean separation of concerns with organized modules
- **Configuration Management**: Centralized config with validation
- **Database Integration**: SQLite/PostgreSQL support with connection pooling
- **Advanced Logging**: Structured logging with Winston
- **Error Handling**: Comprehensive error handling and recovery
- **Security Features**: JWT authentication, rate limiting, input validation

### Developer Experience
- **API Documentation**: Built-in API documentation endpoint
- **Health Monitoring**: System health and statistics endpoints
- **Development Tools**: ESLint, Prettier, Jest testing setup
- **Graceful Shutdown**: Proper cleanup and resource management

## Architecture

```
src/
|-- config/           # Configuration management
|-- middleware/       # Express middleware
|   |-- auth.js      # Authentication & authorization
|   |-- rateLimiter.js # Rate limiting
|-- routes/          # API route handlers
|   |-- auth.js      # Authentication endpoints
|   |-- conversation.js # Chat endpoints
|   |-- api.js       # Legacy and system endpoints
|-- services/        # Business logic
|   |-- ai.js        # AI service integration
|   |-- conversation.js # Conversation management
|   |-- websocket.js # WebSocket handling
|   |-- generator.js # Mod generation (existing)
|   |-- versions.js  # Version management (existing)
|-- utils/           # Utility functions
|   |-- database.js  # Database abstraction
|   |-- logger.js    # Logging system
|-- server.js        # Main server file
```

## Installation

1. Install dependencies:
```bash
npm install
```

2. Copy environment configuration:
```bash
cp .env.example .env
```

3. Configure your `.env` file with your API keys and preferences.

4. Start the server:
```bash
npm start
# Or for development:
npm run dev
```

## API Endpoints

### Authentication
- `POST /auth/register` - Register new user
- `POST /auth/login` - Login user
- `POST /auth/guest` - Create guest session
- `POST /auth/verify` - Verify JWT token
- `POST /auth/refresh` - Refresh JWT token

### Conversations
- `POST /conversation/sessions` - Create new conversation session
- `GET /conversation/sessions/:sessionId/history` - Get conversation history
- `POST /conversation/sessions/:sessionId/chat` - Send message and get response
- `POST /conversation/sessions/:sessionId/chat/stream` - Streaming chat (SSE)
- `POST /conversation/sessions/:sessionId/regenerate` - Regenerate last response
- `PUT /conversation/sessions/:sessionId/messages/:messageId` - Edit message
- `DELETE /conversation/sessions/:sessionId/messages` - Clear conversation
- `GET /conversation/sessions/:sessionId/stats` - Get session statistics
- `DELETE /conversation/sessions/:sessionId` - Delete session

### Mod Generation (Legacy Support)
- `GET /api/versions/:loader` - Get available mod loader versions
- `POST /api/generate` - Generate mod (legacy endpoint)
- `GET /api/download/source/:workId` - Download source code
- `GET /api/download/jar/:workId` - Download compiled JAR

### System
- `GET /api/health` - Health check
- `GET /api/system/info` - System information and stats
- `GET /api/docs` - API documentation

### WebSocket
- `WS /ws/:sessionId` - WebSocket connection for real-time chat and generation

## Configuration

### AI Providers
The system supports multiple AI providers:

**OpenRouter (Recommended - Free)**
```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_key_here
AI_MODEL=mistralai/mistral-7b-instruct
```

**OpenAI**
```env
AI_PROVIDER=openai
OPENAI_API_KEY=your_key_here
AI_MODEL=gpt-3.5-turbo
```

**Anthropic**
```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_key_here
AI_MODEL=claude-3-haiku-20240307
```

### Database
**SQLite (Default)**
```env
DB_TYPE=sqlite
DATABASE_URL=./data/codexmc.db
```

**PostgreSQL**
```env
DB_TYPE=postgresql
DATABASE_URL=postgresql://user:pass@localhost/codexmc
```

## Usage Examples

### Creating a Chat Session
```javascript
const response = await fetch('/conversation/sessions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({})
});
const { sessionId } = await response.json();
```

### Sending a Message
```javascript
const response = await fetch(`/conversation/sessions/${sessionId}/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: "Help me create a Minecraft mod that adds new ores"
  })
});
const { response: aiResponse } = await response.json();
```

### Streaming Chat
```javascript
const eventSource = new EventSource(`/conversation/sessions/${sessionId}/chat/stream`);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'chat_chunk') {
    // Handle streaming chunk
    console.log(data.data.chunk);
  }
};
```

### WebSocket Connection
```javascript
const ws = new WebSocket(`ws://localhost:3000/ws/${sessionId}`);
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
ws.send(JSON.stringify({
  type: 'chat',
  data: { message: "Hello AI!" }
}));
```

## Migration from v1.0

The new backend maintains backward compatibility with the existing frontend. Legacy endpoints are still supported:

- `/api/generate` - Still works for mod generation
- `/api/versions/:loader` - Unchanged
- Download endpoints - Unchanged

However, for the best experience, update your frontend to use the new conversation endpoints for ChatGPT-like interactions.

## Development

### Running Tests
```bash
npm test
```

### Code Formatting
```bash
npm run format
```

### Linting
```bash
npm run lint
```

### Environment Setup
For development, use:
```env
NODE_ENV=development
LOG_LEVEL=debug
```

## Security Features

- **JWT Authentication**: Secure token-based authentication
- **Rate Limiting**: Advanced rate limiting with different tiers
- **Input Validation**: Comprehensive input validation and sanitization
- **CORS Protection**: Configurable CORS settings
- **Security Headers**: Helmet.js for security headers
- **Password Hashing**: bcrypt for secure password storage

## Monitoring & Logging

- **Structured Logging**: JSON-formatted logs with correlation IDs
- **Performance Metrics**: Request timing and system metrics
- **Error Tracking**: Detailed error logging with stack traces
- **Health Checks**: Comprehensive health monitoring

## Contributing

1. Follow the existing code style (Prettier + ESLint)
2. Add tests for new features
3. Update documentation
4. Use semantic versioning for releases

## License

MIT License - see LICENSE file for details.
