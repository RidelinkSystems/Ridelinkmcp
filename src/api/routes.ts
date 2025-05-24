import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { RouteStatus } from '@prisma/client';
import { routingService, RouteOptimizationRequest, RouteWaypoint } from '@/services/routingService';
import { createError } from '@/middleware/errorHandler';

const router = Router();

// Validation schemas
const waypointSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  address: Joi.string().optional(),
  estimatedArrival: Joi.date().iso().optional(),
});

const routeCalculationSchema = Joi.object({
  origin: waypointSchema.required(),
  destination: waypointSchema.required(),
  waypoints: Joi.array().items(waypointSchema).optional(),
  vehicleType: Joi.string().valid(
    'MOTORCYCLE', 'CAR', 'VAN', 'TRUCK_SMALL', 'TRUCK_MEDIUM', 'TRUCK_LARGE'
  ).required(),
  trafficModel: Joi.string().valid('best_guess', 'pessimistic', 'optimistic').optional(),
  departureTime: Joi.date().iso().optional(),
});

const createRouteSchema = Joi.object({
  orderId: Joi.string().required(),
  transporterId: Joi.string().required(),
  routeRequest: routeCalculationSchema.required(),
});

const optimizeMultipleSchema = Joi.object({
  transporterId: Joi.string().required(),
  deliveryPoints: Joi.array().items(waypointSchema).min(2).required(),
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid(...Object.values(RouteStatus)).required(),
  actualDuration: Joi.number().positive().optional(),
});

const recalculateRouteSchema = Joi.object({
  currentLocation: waypointSchema.required(),
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

// Routes

// POST /api/v1/routes/calculate - Calculate optimal route
router.post('/calculate', validateRequest(routeCalculationSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const routeRequest: RouteOptimizationRequest = {
      ...req.body,
      departureTime: req.body.departureTime ? new Date(req.body.departureTime) : undefined,
    };

    const optimizedRoute = await routingService.calculateOptimalRoute(routeRequest);

    res.json({
      success: true,
      data: optimizedRoute,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/routes - Create route for order
router.post('/', validateRequest(createRouteSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId, transporterId, routeRequest } = req.body;

    const route = await routingService.createRoute(orderId, transporterId, {
      ...routeRequest,
      departureTime: routeRequest.departureTime ? new Date(routeRequest.departureTime) : undefined,
    });

    res.status(201).json({
      success: true,
      data: route,
      message: 'Route created successfully',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/routes/:id - Get route details
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const route = await routingService.getRouteById(req.params.id);

    res.json({
      success: true,
      data: route,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v1/routes/:id/status - Update route status
router.put('/:id/status', validateRequest(updateStatusSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, actualDuration } = req.body;
    const route = await routingService.updateRouteStatus(req.params.id, status, actualDuration);

    res.json({
      success: true,
      data: route,
      message: `Route status updated to ${status}`,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/routes/optimize - Optimize multiple deliveries
router.post('/optimize', validateRequest(optimizeMultipleSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transporterId, deliveryPoints } = req.body;
    const optimizedRoute = await routingService.optimizeMultipleDeliveries(transporterId, deliveryPoints);

    res.json({
      success: true,
      data: optimizedRoute,
      message: 'Route optimized for multiple deliveries',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/routes/:id/traffic - Get real-time traffic conditions
router.get('/:id/traffic', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const trafficConditions = await routingService.getRealTimeTrafficUpdate(req.params.id);

    res.json({
      success: true,
      data: {
        routeId: req.params.id,
        trafficConditions,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/routes/:id/recalculate - Recalculate route from current position
router.post('/:id/recalculate', validateRequest(recalculateRouteSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { currentLocation } = req.body;
    const newRoute = await routingService.recalculateRoute(req.params.id, currentLocation);

    res.json({
      success: true,
      data: newRoute,
      message: 'Route recalculated successfully',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/routes/:id/tracking - Get route tracking information
router.get('/:id/tracking', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const route = await routingService.getRouteById(req.params.id);
    
    // Get latest tracking data for the transporter
    const trackingData = await require('@/config/database').default.trackingData.findMany({
      where: { 
        transporterId: route.transporterId,
        orderId: route.orderId 
      },
      orderBy: { timestamp: 'desc' },
      take: 1,
    });

    const currentLocation = trackingData[0] || null;
    const routePath = route.optimizedPath as RouteWaypoint[];

    // Calculate progress
    let progress = 0;
    if (currentLocation && routePath.length > 0) {
      const distances = routePath.map(point => {
        const R = 6371; // Earth's radius in km
        const dLat = (point.latitude - currentLocation.latitude) * (Math.PI / 180);
        const dLon = (point.longitude - currentLocation.longitude) * (Math.PI / 180);
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(currentLocation.latitude * (Math.PI / 180)) * Math.cos(point.latitude * (Math.PI / 180)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        
        return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * R;
      });

      const closestPointIndex = distances.indexOf(Math.min(...distances));
      progress = Math.round((closestPointIndex / (routePath.length - 1)) * 100);
    }

    res.json({
      success: true,
      data: {
        route,
        currentLocation,
        progress,
        estimatedTimeRemaining: route.estimatedDuration * (1 - progress / 100),
        lastUpdate: currentLocation?.timestamp || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;