// backend/src/workspace.ts
// Workspace management routes: credentials, invites, etc.

import express from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import {
  updateWorkspaceCredentials,
  getWorkspace,
  createInvite,
  getInviteByCode,
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

export default router;
