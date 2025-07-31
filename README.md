# EarnSphereX Backend Server

## Overview

This is the backend server for EarnSphereX, a platform that connects buyers and workers for task completion. The server provides APIs for user management, task handling, payment processing, and notifications.

## Features

- **User Management**: Registration, authentication, and role-based access control
- **Task System**: Create, manage, and track tasks with submissions
- **Payment Processing**: Coin purchases and withdrawal requests
- **Notifications**: Real-time updates for users
- **Admin Dashboard**: Comprehensive statistics and management tools

## Technology Stack

- **Node.js**: JavaScript runtime environment
- **Express**: Web application framework
- **MongoDB**: NoSQL database
- **Firebase Admin**: Authentication and authorization
- **Stripe**: Payment processing

## Environment Variables

The server requires the following environment variables:

```
DB_URI=mongodb+srv://<username>:<password>@cluster0.nbilkdt.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
PAYMENT_GATEWAY_KEY=<stripe_secret_key>
FB_SERVICE_KEY=<base64_encoded_firebase_service_account>
```

## API Documentation

The server provides the following API endpoints:

### Authentication
- All endpoints require Firebase authentication token in the `Authorization` header

### User Endpoints
- `GET /users` - Get all users
- `POST /users` - Create new user
- `GET /users/:email` - Get user by email
- `PATCH /users/:email` - Update user
- `DELETE /users/:id` - Delete user (admin only)
- `PATCH /users/:id/role` - Update user role (admin only)

### Task Endpoints
- `GET /tasks` - Get all tasks
- `POST /tasks` - Create new task (buyer only)
- `GET /tasks/:email` - Get tasks by creator email
- `DELETE /tasks/:id` - Delete task
- `PATCH /tasks/:id` - Update task

### Payment Endpoints
- `GET /pay` - Get coin packages
- `POST /payments` - Process payment
- `POST /create-payment-intent` - Create Stripe payment intent

### Withdrawal Endpoints
- `GET /withdrawal-requests` - Get pending withdrawals (admin only)
- `POST /withdrawals` - Create withdrawal request (worker only)
- `PATCH /approve-withdrawal/:id` - Approve withdrawal (admin only)

### Notification Endpoints
- `POST /notifications` - Create notification
- `GET /notifications/:email` - Get notifications by email
- `PATCH /notifications/mark-read/:id` - Mark notification as read
- `GET /notifications/unread-count/:email` - Get unread notification count

## Installation

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables
4. Start the server: `npm start`

## Security

- All endpoints require authentication
- Role-based access control for sensitive operations
- Secure payment processing with Stripe
- Firebase token verification for all requests

## Error Handling

The server returns appropriate HTTP status codes and error messages for:
- Authentication failures (401)
- Authorization failures (403)
- Resource not found (404)
- Server errors (500)

## Monitoring

The server logs all errors and important events to the console for debugging and monitoring purposes.