// backend/src/workspace.ts
// Workspace management routes: credentials, invites, etc.

import express from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import {
  updateWorkspaceCredentials,
  getWorkspace,
  getWorkspaceAdmins,
  searchWorkspaces,
  createInvite,
  getInviteByCode,
  createJoinRequest,
  getJoinRequest,
  getJoinRequestsByWorkspace,
  approveJoinRequest,
  rejectJoinRequest,
  insertAudit,
} from './db';
import { authMiddleware, AuthRequest } from './middleware/authMiddleware';
import { config } from './config';
import { AppError, asyncHandler } from './errors';
import { validate } from './validate';
import { encrypt, decrypt } from './crypto';
import { logger } from './logger';

const router = express.Router();

// ---- SET AWS CREDENTIALS ----
const credentialsSchema = z.object({
  accessKeyId: z.string().min(1).max(255),
  secretAccessKey: z.string().min(1).max(255),
  region: z.string().min(1).max(64).optional(),
});

router.post(
  '/credentials',
  authMiddleware,
  validate(credentialsSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    if (req.user.role !== 'admin') {
      throw new AppError('forbidden', 403, 'Only workspace admins can set AWS credentials.');
    }

    const { accessKeyId, secretAccessKey, region = 'us-east-1' } =
      req.body as z.infer<typeof credentialsSchema>;
    const workspaceId = req.user.workspaceId;

    try {
      // Encrypt credentials
      const accessKeyEnc = encrypt(accessKeyId, config.credentials.encryptionKey);
      const secretKeyEnc = encrypt(secretAccessKey, config.credentials.encryptionKey);

      // Update workspace
      await updateWorkspaceCredentials(workspaceId, accessKeyEnc, secretKeyEnc, region);

      // Log audit
      await insertAudit(workspaceId, req.user.sub, 'workspace_credentials_updated', 'workspace', {
        region,
      });

      res.json({ ok: true });
    } catch (err: any) {
      logger.error({ err }, 'Failed to encrypt or update credentials');
      throw new AppError('credential_update_failed', 500, 'Failed to save credentials.');
    }
  })
);

// ---- CREATE INVITE ----
const inviteSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
});

router.post(
  '/invite',
  authMiddleware,
  validate(inviteSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    if (req.user.role !== 'admin') {
      throw new AppError('forbidden', 403, 'Only workspace admins can create invites.');
    }

    const { role = 'member' } = req.body as z.infer<typeof inviteSchema>;
    const workspaceId = req.user.workspaceId;

    try {
      // Generate 24-byte random code (48-char hex)
      const code = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

      const inviteId = await createInvite(
        workspaceId,
        code,
        req.user.sub,
        role,
        expiresAt
      );

      // Log audit
      await insertAudit(workspaceId, req.user.sub, 'invite_created', 'workspace', {
        code,
        role,
        expiresAt,
      });

      // Get app URL from env, default to localhost:3000
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const joinUrl = `${appUrl}/join?code=${code}`;

      res.json({
        code,
        joinUrl,
        expiresAt: expiresAt.toISOString(),
        expiresIn: '48h',
      });
    } catch (err: any) {
      logger.error({ err }, 'Failed to create invite');
      throw new AppError('invite_creation_failed', 500, 'Failed to create invite.');
    }
  })
);

// ---- VALIDATE INVITE ----
router.get(
  '/invite/:code',
  asyncHandler(async (req, res) => {
    const { code } = req.params;

    try {
      const invite = await getInviteByCode(code);
      if (!invite) {
        throw new AppError('invalid_invite', 400, 'Invite code not found.');
      }

      // Check if expired
      if (new Date(invite.expires_at) < new Date()) {
        throw new AppError('invite_expired', 400, 'Invite has expired.');
      }

      // Check if already used
      if (invite.used_at) {
        throw new AppError('invite_used', 400, 'Invite has already been used.');
      }

      // Return workspace name for display during join
      const workspace = await getWorkspace(invite.workspace_id);
      if (!workspace) {
        throw new AppError('workspace_not_found', 404);
      }

      res.json({
        valid: true,
        workspaceName: workspace.name,
        workspaceId: workspace.id,
        role: invite.role,
        expiresAt: invite.expires_at,
      });
    } catch (err: any) {
      if (err instanceof AppError) {
        throw err;
      }
      logger.error({ err }, 'Failed to validate invite');
      throw new AppError('invite_validation_failed', 500, 'Failed to validate invite.');
    }
  })
);

// ---- SEARCH WORKSPACES ----
const searchSchema = z.object({
  q: z.string().min(1).max(255),
});

router.get(
  '/search',
  validate(searchSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { q } = req.query as any;
    const workspaces = await searchWorkspaces(q);
    res.json(workspaces);
  })
);

// ---- REQUEST TO JOIN WORKSPACE ----
const joinRequestSchema = z.object({
  workspaceId: z.number(),
  username: z.string().min(1).max(128),
  email: z.string().email(),
  fullName: z.string().max(255).optional(),
});

router.post(
  '/join-request',
  validate(joinRequestSchema),
  asyncHandler(async (req, res) => {
    const { workspaceId, email, username, fullName } = req.body as z.infer<typeof joinRequestSchema>;

    const workspace = await getWorkspace(workspaceId);
    if (!workspace) {
      throw new AppError('workspace_not_found', 404, 'Workspace not found.');
    }

    try {
      const requestId = await createJoinRequest(workspaceId, email, username, fullName);

      // Get workspace admins for notification
      const admins = await getWorkspaceAdmins(workspaceId);

      // Log audit
      await insertAudit(workspaceId, null, 'join_request_created', 'workspace', {
        email,
        username,
      });

      res.status(201).json({
        requestId,
        message: 'Join request submitted. Admins will review shortly.',
        admins: admins.map((a) => ({ email: a.email, username: a.username })),
      });
    } catch (err: any) {
      if (err.code === '23505') {
        // unique_violation
        throw new AppError('request_exists', 409, 'You have already requested to join this workspace.');
      }
      logger.error({ err }, 'Failed to create join request');
      throw new AppError('join_request_failed', 500, 'Failed to submit join request.');
    }
  })
);

// ---- GET PENDING JOIN REQUESTS (Admin only) ----
router.get(
  '/join-requests',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    if (req.user.role !== 'admin') {
      throw new AppError('forbidden', 403, 'Only admins can view join requests.');
    }

    const requests = await getJoinRequestsByWorkspace(req.user.workspaceId, 'pending');
    res.json(requests);
  })
);

// ---- APPROVE JOIN REQUEST (Admin only) ----
router.patch(
  '/join-request/:id/approve',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    if (req.user.role !== 'admin') {
      throw new AppError('forbidden', 403, 'Only admins can approve requests.');
    }

    const { id } = req.params;
    const requestId = parseInt(id, 10);
    if (isNaN(requestId)) {
      throw new AppError('invalid_id', 400, 'Invalid request ID.');
    }

    const joinReq = await getJoinRequest(requestId);
    if (!joinReq) {
      throw new AppError('not_found', 404, 'Join request not found.');
    }

    if (joinReq.workspace_id !== req.user.workspaceId) {
      throw new AppError('forbidden', 403, 'Cannot approve requests for other workspaces.');
    }

    await approveJoinRequest(requestId, req.user.sub);

    // Log audit
    await insertAudit(req.user.workspaceId, req.user.sub, 'join_request_approved', 'workspace', {
      email: joinReq.email,
      username: joinReq.username,
    });

    // Generate invite for approved user
    const code = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
    await createInvite(req.user.workspaceId, code, req.user.sub, 'member', expiresAt);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const joinUrl = `${appUrl}/join?code=${code}`;

    res.json({
      approved: true,
      joinUrl,
      expiresAt: expiresAt.toISOString(),
      message: `Join request approved. Share this link with ${joinReq.email}: ${joinUrl}`,
    });
  })
);

// ---- REJECT JOIN REQUEST (Admin only) ----
router.patch(
  '/join-request/:id/reject',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    if (!req.user) throw new AppError('unauthorized', 401);
    if (req.user.role !== 'admin') {
      throw new AppError('forbidden', 403, 'Only admins can reject requests.');
    }

    const { id } = req.params;
    const requestId = parseInt(id, 10);
    if (isNaN(requestId)) {
      throw new AppError('invalid_id', 400, 'Invalid request ID.');
    }

    const joinReq = await getJoinRequest(requestId);
    if (!joinReq) {
      throw new AppError('not_found', 404, 'Join request not found.');
    }

    if (joinReq.workspace_id !== req.user.workspaceId) {
      throw new AppError('forbidden', 403, 'Cannot reject requests for other workspaces.');
    }

    await rejectJoinRequest(requestId, req.user.sub);

    // Log audit
    await insertAudit(req.user.workspaceId, req.user.sub, 'join_request_rejected', 'workspace', {
      email: joinReq.email,
      username: joinReq.username,
    });

    res.json({
      rejected: true,
      message: `Join request from ${joinReq.email} has been rejected.`,
    });
  })
);

// ---- GET WORKSPACE ADMINS ----
router.get(
  '/:id/admins',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const workspaceId = parseInt(id, 10);
    if (isNaN(workspaceId)) {
      throw new AppError('invalid_id', 400, 'Invalid workspace ID.');
    }

    const admins = await getWorkspaceAdmins(workspaceId);
    res.json({ admins });
  })
);

export default router;
