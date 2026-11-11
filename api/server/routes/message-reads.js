const express = require('express');
const { createMessageReadHandler, createMessageReadLimits } = require('@librechat/api');
const { requireJwtAuth, createMessageRequestValidation } = require('~/server/middleware');
const { getAppConfig } = require('~/server/services/Config');
const db = require('~/models');
const router = express.Router();
const deps = {
  getMessageReadMetadata: db.getMessageReadMetadata,
  getMessageReadContent: db.getMessageReadContent,
  validate: (req) =>
    createMessageRequestValidation(req, { activeJobMessageRead: true, explicitTenantScope: true }),
  getLimits: createMessageReadLimits(getAppConfig),
  getCursorKey: () => process.env.JWT_SECRET,
};
router.use(requireJwtAuth);
router.get('/list', createMessageReadHandler(deps, 'list'));
router.get('/content', createMessageReadHandler(deps, 'content'));
router.get('/read', createMessageReadHandler(deps, 'read'));
module.exports = router;
