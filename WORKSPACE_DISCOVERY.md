# Workspace Discovery & Join Request System

## Problem Solved
When multiple employees from the same organization try to use the SaaS app, they need a way to find and join the same workspace. Previously:
- User 1 would sign up and create a workspace for Company A
- User 2 from Company A would not know the workspace exists
- User 2 might create a duplicate workspace
- Data becomes fragmented across multiple workspaces

## Solution Implemented

### 1. Email Domain-Based Workspace Detection (Solution 1)

When a user tries to sign up:
```
User enters: email: bob@techcorp.io
↓
System extracts domain: techcorp.io
↓
Checks if workspace exists for @techcorp.io
↓
If YES: Shows workspace info + admin details (User can request to join)
If NO: Creates new workspace with domain attached
```

**API Response when workspace found:**
```json
{
  "workspaceFound": true,
  "workspace": {
    "id": 9,
    "name": "TechCorp",
    "admins": [
      {
        "id": 9,
        "email": "alice@techcorp.io",
        "username": "alice"
      }
    ]
  },
  "message": "A workspace 'TechCorp' already exists for your organization..."
}
```

### 2. Workspace Directory & Join Requests (Solution 2)

Users can search for and request to join workspaces:

**Search Workspaces:**
```bash
GET /api/workspace/search?q=TechCorp
```

**Submit Join Request:**
```bash
POST /api/workspace/join-request
{
  "workspaceId": 9,
  "email": "bob@techcorp.io",
  "username": "bob",
  "fullName": "Bob Smith"
}
```

Response includes workspace admins:
```json
{
  "requestId": 1,
  "message": "Join request submitted. Admins will review shortly.",
  "admins": [
    {
      "email": "alice@techcorp.io",
      "username": "alice"
    }
  ]
}
```

### 3. Admin Approval & Notification

Admins can view pending join requests:

**List Pending Requests:**
```bash
GET /api/workspace/join-requests
Authorization: Bearer <admin_token>
```

Response:
```json
[
  {
    "id": 1,
    "workspace_id": 9,
    "email": "bob@techcorp.io",
    "username": "bob",
    "full_name": "Bob Smith",
    "status": "pending",
    "requested_at": "2026-05-12T15:22:36.107Z"
  }
]
```

**Approve Request & Auto-Generate Invite:**
```bash
PATCH /api/workspace/join-request/1/approve
Authorization: Bearer <admin_token>
```

Response includes invite URL:
```json
{
  "approved": true,
  "joinUrl": "http://localhost:3000/join?code=abc123...",
  "expiresAt": "2026-05-14T15:22:51.274Z",
  "message": "Join request approved. Share this link with bob@techcorp.io: ..."
}
```

Admin can then share the join URL directly with the user, or the system can send email (future enhancement).

## Complete User Flow

### Scenario: 3 employees from TechCorp

**Step 1: Alice (Admin) Signs Up**
```
1. Visits signup page
2. Enters: email: alice@techcorp.io, username: alice, password: ***
3. System checks: No workspace for @techcorp.io
4. Creates workspace "TechCorp" with organization_domain: techcorp.io
5. Alice becomes admin
6. Alice redirected to /connect-aws to configure AWS credentials
```

**Step 2: Bob Tries to Sign Up**
```
1. Visits signup page
2. Enters: email: bob@techcorp.io, username: bob, password: ***
3. System checks: Workspace exists for @techcorp.io!
4. Shows "Workspace Found" screen:
   - Workspace name: "TechCorp"
   - Admin: alice (alice@techcorp.io)
5. Bob clicks "Request to Join"
6. Bob submitted request confirmation screen
```

**Step 3: Alice Gets Notification (Future: Email)**
```
1. Alice logs in
2. Goes to Users/Admin panel
3. Sees pending request from bob@techcorp.io
4. Reviews request (can see username, email, timestamp)
5. Clicks "Approve"
6. System generates invite code (48-hour expiration)
7. Alice gets invite URL to share: /join?code=abc123xyz
```

**Step 4: Bob Accepts Invite**
```
1. Alice shares join URL with Bob (via email/message)
2. Bob clicks link → /join?code=abc123xyz
3. Bob enters: email: bob@techcorp.io, username: bob, password: ***
4. Bob joins workspace and can now access company S3 buckets
```

**Step 5: Carol Also Joins**
```
1. Carol tries to signup with carol@techcorp.io
2. System detects workspace exists
3. Carol sees alice@techcorp.io as admin
4. Carol can email Alice or use "Request to Join" flow
5. Alice approves and shares invite
6. Carol joins
```

## Database Schema

### New Columns
```sql
ALTER TABLE workspaces ADD COLUMN organization_domain TEXT;
CREATE INDEX idx_workspaces_domain ON workspaces(organization_domain);
```

### New Table: join_requests
```sql
CREATE TABLE join_requests (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL,
  username TEXT NOT NULL,
  full_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by INTEGER REFERENCES users(id),
  UNIQUE (workspace_id, email),
  CHECK (status IN ('pending', 'approved', 'rejected'))
);
```

## API Endpoints

### Public Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/workspace/search?q=query` | Search workspaces |
| POST | `/api/workspace/join-request` | Submit join request |
| GET | `/api/workspace/:id/admins` | Get workspace admins |

### Admin Endpoints (Auth Required)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/workspace/join-requests` | List pending requests |
| PATCH | `/api/workspace/join-request/:id/approve` | Approve request + generate invite |
| PATCH | `/api/workspace/join-request/:id/reject` | Reject request |

## Frontend Pages

### New Pages
- `/join-workspace` - Search and request to join existing workspace
- `/signup` - Updated with workspace discovery flow

### Updated Pages
- `/login` - Can show "Join existing workspace" option
- `/users` (Future) - Admin dashboard to manage join requests

## Future Enhancements

1. **Email Notifications**
   - Email sent to user when request is approved with join link
   - Email notification to admins when new request received

2. **Admin Dashboard**
   - Dedicated admin panel for managing join requests
   - Bulk approve/reject
   - Audit log of all approvals

3. **Auto-Join for Company Email**
   - Option to auto-approve all requests from @company.com domain
   - Configurable per workspace

4. **Domain Verification**
   - Admins verify they own the domain
   - Automatically whitelist domain for auto-join

5. **Invitation Roles**
   - Admin can specify role when approving (admin/member/viewer)
   - Different permissions for different role types

## Testing

All features tested and working:

✅ Workspace creation with domain tracking
✅ Workspace discovery by email domain
✅ Join request submission
✅ Admin viewing pending requests
✅ Request approval with auto-invite generation
✅ Request rejection
✅ Admin contact information display

## Migration & Deployment

**Migration 003** handles all database changes:
- Adds `organization_domain` to workspaces table
- Creates `join_requests` table with proper constraints
- Creates indexes for performance

Run automatically on app startup via `runMigrations()`.

## Security Considerations

- Join requests can only be submitted with valid email/username
- Only workspace admins can approve/reject requests
- Invite codes are 24-byte random (192-bit entropy)
- Invites expire after 48 hours
- Workspace isolation maintained via workspace_id
- All actions logged in audit_logs table
