/**
 * Vercel Serverless entry.
 * نفس تطبيق Express اللي في server.js — بدون listen (Vercel هو اللي بيستدعيه).
 */
module.exports = require('../server');
