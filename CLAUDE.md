# CLAUDE.md

This file provides guidance to Claude Code (https://claude.ai/code) and other AI code assistants when working with code in this repository. 

This is the backend server for Ridelink MCP , which serves as the orchestration engine for core logistics operations.

## Project Status

This is an active backend service under development for Ridelink. It powers intelligent routing, transporter matching, and internal business operations automation via APIs and data processing layers.

## Common Commands

```bash
# Development
npm run dev              # Start development server with hot reload
npm run build           # Build for production
npm run start           # Start production server

# Database
npm run db:migrate      # Run database migrations
npm run db:generate     # Generate Prisma client
npm run db:seed         # Seed database with test data

# Testing & Quality
npm run test            # Run test suite
npm run test:watch      # Run tests in watch mode
npm run lint            # Check code style
npm run lint:fix        # Fix linting issues
npm run typecheck       # Check TypeScript types
```

## Architecture

**Tech Stack**: Node.js + TypeScript + Express + Prisma + PostgreSQL + Redis + Socket.IO

**Core Modules**:
- **Routing Engine**: Optimizes delivery routes using external mapping APIs
- **Matching System**: Pairs orders with suitable transporters based on capacity, location, and availability
- **Order Management**: Handles complete order lifecycle from creation to delivery
- **Real-time Tracking**: WebSocket-based live location and status updates
- **Business Automation**: Automated dispatch, pricing, and performance analytics

**Key Patterns**:
- Path aliases: Use `@/` prefix for imports (e.g., `@/services/routing`)
- Database access via Prisma ORM with connection pooling
- Redis for caching and session management
- Winston for structured logging
- Bull queues for background job processing
- Socket.IO for real-time client communication

## Environment Setup

1. Copy `.env.example` to `.env` and configure database/API keys
2. Install dependencies: `npm install`
3. Set up PostgreSQL and Redis databases
4. Run migrations: `npm run db:migrate`
5. Start development: `npm run dev`
