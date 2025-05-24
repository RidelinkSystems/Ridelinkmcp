import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { TransporterStatus, VehicleType } from '@prisma/client';
import { transporterService, CreateTransporterData, UpdateTransporterData } from '@/services/transporterService';
import { createError } from '@/middleware/errorHandler';

const router = Router();

// Validation schemas
const createTransporterSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  licenseNumber: Joi.string().min(5).max(50).required(),
  phoneNumber: Joi.string().pattern(/^\+?[\d\s\-\(\)]+$/).required(),
  email: Joi.string().email().required(),
  vehicleType: Joi.string().valid(...Object.values(VehicleType)).required(),
  capacityWeight: Joi.number().positive().required(),
  capacityVolume: Joi.number().positive().required(),
});

const updateTransporterSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  phoneNumber: Joi.string().pattern(/^\+?[\d\s\-\(\)]+$/).optional(),
  email: Joi.string().email().optional(),
  vehicleType: Joi.string().valid(...Object.values(VehicleType)).optional(),
  capacityWeight: Joi.number().positive().optional(),
  capacityVolume: Joi.number().positive().optional(),
  currentLocation: Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
  }).optional(),
  availabilityStatus: Joi.string().valid(...Object.values(TransporterStatus)).optional(),
});

const transporterFiltersSchema = Joi.object({
  status: Joi.string().valid(...Object.values(TransporterStatus)).optional(),
  vehicleType: Joi.string().valid(...Object.values(VehicleType)).optional(),
  isVerified: Joi.boolean().optional(),
  nearLatitude: Joi.number().min(-90).max(90).optional(),
  nearLongitude: Joi.number().min(-180).max(180).optional(),
  radiusKm: Joi.number().positive().max(1000).optional(),
  minCapacityWeight: Joi.number().positive().optional(),
  minCapacityVolume: Joi.number().positive().optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  offset: Joi.number().integer().min(0).optional(),
});

const statusUpdateSchema = Joi.object({
  status: Joi.string().valid(...Object.values(TransporterStatus)).required(),
});

const locationUpdateSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
});

// Validation middleware
const validateRequest = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body);
    if (error) {
      return next(createError(error.details[0].message, 400));
    }
    next();
  };
};

const validateQuery = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.query);
    if (error) {
      return next(createError(error.details[0].message, 400));
    }
    next();
  };
};

// Routes

// POST /api/v1/transporters - Register new transporter
router.post('/', validateRequest(createTransporterSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transporterData: CreateTransporterData = req.body;
    const transporter = await transporterService.createTransporter(transporterData);

    res.status(201).json({
      success: true,
      data: transporter,
      message: 'Transporter registered successfully. Verification pending.',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/transporters - List transporters with filters
router.get('/', validateQuery(transporterFiltersSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters: any = {
      ...req.query,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
      minCapacityWeight: req.query.minCapacityWeight ? parseFloat(req.query.minCapacityWeight as string) : undefined,
      minCapacityVolume: req.query.minCapacityVolume ? parseFloat(req.query.minCapacityVolume as string) : undefined,
    };

    // Handle location-based filtering
    if (req.query.nearLatitude && req.query.nearLongitude) {
      filters.nearLocation = {
        latitude: parseFloat(req.query.nearLatitude as string),
        longitude: parseFloat(req.query.nearLongitude as string),
        radiusKm: req.query.radiusKm ? parseFloat(req.query.radiusKm as string) : 10,
      };
      
      // Remove individual location params
      delete filters.nearLatitude;
      delete filters.nearLongitude;
      delete filters.radiusKm;
    }

    const result = await transporterService.getTransporters(filters);

    res.json({
      success: true,
      data: result.transporters,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/transporters/available - Get available transporters
router.get('/available', validateQuery(transporterFiltersSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters: any = {
      vehicleType: req.query.vehicleType,
      minCapacityWeight: req.query.minCapacityWeight ? parseFloat(req.query.minCapacityWeight as string) : undefined,
      minCapacityVolume: req.query.minCapacityVolume ? parseFloat(req.query.minCapacityVolume as string) : undefined,
    };

    if (req.query.nearLatitude && req.query.nearLongitude) {
      filters.nearLocation = {
        latitude: parseFloat(req.query.nearLatitude as string),
        longitude: parseFloat(req.query.nearLongitude as string),
        radiusKm: req.query.radiusKm ? parseFloat(req.query.radiusKm as string) : 10,
      };
    }

    const result = await transporterService.getAvailableTransporters(filters);

    res.json({
      success: true,
      data: result.transporters,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/transporters/:id - Get transporter profile
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transporter = await transporterService.getTransporterById(req.params.id);

    res.json({
      success: true,
      data: transporter,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v1/transporters/:id - Update transporter profile
router.put('/:id', validateRequest(updateTransporterSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const updateData: UpdateTransporterData = req.body;
    const transporter = await transporterService.updateTransporter(req.params.id, updateData);

    res.json({
      success: true,
      data: transporter,
      message: 'Transporter profile updated successfully',
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v1/transporters/:id/status - Update availability status
router.put('/:id/status', validateRequest(statusUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;
    const transporter = await transporterService.updateStatus(req.params.id, status);

    res.json({
      success: true,
      data: transporter,
      message: `Status updated to ${status}`,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v1/transporters/:id/location - Update current location
router.put('/:id/location', validateRequest(locationUpdateSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { latitude, longitude } = req.body;
    await transporterService.updateLocation(req.params.id, { latitude, longitude });

    res.json({
      success: true,
      message: 'Location updated successfully',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/transporters/:id/orders - Get transporter's orders
router.get('/:id/orders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const result = await transporterService.getTransporterOrders(req.params.id, limit, offset);

    res.json({
      success: true,
      data: result.orders,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/transporters/:id/rating - Update transporter rating
router.post('/:id/rating', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return next(createError('Rating must be between 1 and 5', 400));
    }

    await transporterService.updateRating(req.params.id, rating);

    res.json({
      success: true,
      message: 'Rating updated successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;