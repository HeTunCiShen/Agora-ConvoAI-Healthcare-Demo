// backend/routes/healthcare_routes.js
const express = require('express');
const path = require('path');
const { makeHealthcareController } = require('../controllers/healthcareController');
const { createDb } = require('../db/database');
const { seed } = require('../db/seed');
const sse = require('../sse');

const dbPath = process.env.NODE_ENV === 'test'
  ? ':memory:'
  : path.join(__dirname, '../db/healthcare.db');

const db = createDb(dbPath);
seed(db);

const controller = makeHealthcareController(db, sse);
const router = express.Router();

router.get('/profiles/:id', controller.getProfile);
router.get('/profiles', controller.listProfiles);
router.get('/summaries', controller.listSummaries);
router.post('/summaries', controller.createSummary);
router.post('/summarize', controller.generateSummary);
router.get('/care-plans/:patientId', controller.getCarePlan);
router.put('/care-plans/:id', controller.updateCarePlan);

module.exports = { router, controller };
