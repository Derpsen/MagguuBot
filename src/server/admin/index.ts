import { Hono } from 'hono';
import { requireAdmin } from '../auth/middleware.js';
import { getMe, postLogout, postSessionsRevoke } from './session.js';
import { getSearch, getStats, getServicesHealth } from './overview.js';
import {
  getWarnings,
  deleteWarningsId,
  getTickets,
  postTicketsIdClose,
  getAuditLog
} from './moderation.js';
import {
  getXp,
  getReminders,
  deleteRemindersId,
  getReputation
} from './members.js';
import {
  getWebhooks,
  getWebhooksHealth,
  postWebhooksIdReplay,
  deleteWebhooks
} from './webhooks.js';
import {
  getRss,
  postRss,
  patchRssId,
  deleteRssId
} from './rss.js';
import {
  getSettings,
  putSettings,
  getGuild,
  postAutoRoleReconcile
} from './settings.js';
import { getChannels, putChannelsKey } from './channels.js';
import {
  getSeerr,
  getSeerrWeekly,
  postSeerrIdApprove,
  postSeerrIdDecline
} from './requests.js';
import {
  getRolePanels,
  deleteRolePanelsMessageId,
  getTags,
  postTags,
  deleteTagsName,
  getAutoresponders,
  postAutoresponders,
  patchAutorespondersId,
  deleteAutorespondersId,
  getScheduled,
  patchScheduledId,
  deleteScheduledId
} from './content.js';

export const adminRouter = new Hono();

adminRouter.use('*', requireAdmin);

adminRouter.get('/me', getMe);
adminRouter.post('/logout', postLogout);
adminRouter.get('/search', getSearch);
adminRouter.get('/stats', getStats);
adminRouter.get('/services/health', getServicesHealth);
adminRouter.get('/warnings', getWarnings);
adminRouter.delete('/warnings/:id', deleteWarningsId);
adminRouter.get('/xp', getXp);
adminRouter.get('/webhooks', getWebhooks);
adminRouter.get('/webhooks/health', getWebhooksHealth);
adminRouter.post('/webhooks/:id/replay', postWebhooksIdReplay);
adminRouter.get('/rss', getRss);
adminRouter.post('/rss', postRss);
adminRouter.patch('/rss/:id', patchRssId);
adminRouter.delete('/rss/:id', deleteRssId);
adminRouter.delete('/webhooks', deleteWebhooks);
adminRouter.get('/settings', getSettings);
adminRouter.put('/settings', putSettings);
adminRouter.get('/guild', getGuild);
adminRouter.post('/auto-role/reconcile', postAutoRoleReconcile);
adminRouter.get('/channels', getChannels);
adminRouter.put('/channels/:key', putChannelsKey);
adminRouter.get('/reminders', getReminders);
adminRouter.delete('/reminders/:id', deleteRemindersId);
adminRouter.get('/seerr', getSeerr);
adminRouter.get('/seerr/weekly', getSeerrWeekly);
adminRouter.post('/seerr/:id/approve', postSeerrIdApprove);
adminRouter.post('/seerr/:id/decline', postSeerrIdDecline);
adminRouter.get('/role-panels', getRolePanels);
adminRouter.delete('/role-panels/:messageId', deleteRolePanelsMessageId);
adminRouter.get('/tags', getTags);
adminRouter.post('/tags', postTags);
adminRouter.delete('/tags/:name', deleteTagsName);
adminRouter.get('/autoresponders', getAutoresponders);
adminRouter.post('/autoresponders', postAutoresponders);
adminRouter.patch('/autoresponders/:id', patchAutorespondersId);
adminRouter.delete('/autoresponders/:id', deleteAutorespondersId);
adminRouter.get('/scheduled', getScheduled);
adminRouter.patch('/scheduled/:id', patchScheduledId);
adminRouter.delete('/scheduled/:id', deleteScheduledId);
adminRouter.get('/tickets', getTickets);
adminRouter.post('/tickets/:id/close', postTicketsIdClose);
adminRouter.get('/reputation', getReputation);
adminRouter.get('/audit-log', getAuditLog);
adminRouter.post('/sessions/revoke', postSessionsRevoke);
