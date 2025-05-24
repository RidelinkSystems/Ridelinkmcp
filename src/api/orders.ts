import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { OrderStatus } from '@prisma/client';
import { orderService, CreateOrderData } from '@/services/orderService';
import { createError } from '@/middleware/errorHandler';

const router = Router();

// Validation schemas
const createOrderSchema = Joi.object({
  customerId: Joi.string().required(),
  pickupLocation: Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    address: Joi.string().required(),
  }).required(),
  deliveryLocation: Joi.object({
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    address: Joi.string().required(),
  }).required(),
  pickupTime: Joi.date().iso().required(),
  deliveryTime: Joi.date().iso().optional(),
  weight: Joi.number().positive().required(),
  dimensions: Joi.object({
    length: Joi.number().positive().required(),
    width: Joi.number().positive().required(),
    height: Joi.number().positive().required(),
  }).required(),
  specialRequirements: Joi.string().optional(),
});

const orderFiltersSchema = Joi.object({
  status: Joi.string().valid(...Object.values(OrderStatus)).optional(),
  customerId: Joi.string().optional(),
  transporterId: Joi.string().optional(),
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  offset: Joi.number().integer().min(0).optional(),
});

const assignTransporterSchema = Joi.object({
  transporterId: Joi.string().required(),
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

// POST /api/v1/orders - Create new order
router.post('/', validateRequest(createOrderSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderData: CreateOrderData = req.body;
    
    // Calculate estimated cost
    const estimatedCost = await orderService.calculateEstimatedCost(orderData);
    
    // Create order
    const order = await orderService.createOrder({
      ...orderData,
      pickupTime: new Date(orderData.pickupTime),
      deliveryTime: orderData.deliveryTime ? new Date(orderData.deliveryTime) : undefined,
    });

    // Update with estimated cost
    const updatedOrder = await orderService.updateOrderStatus(order.id, OrderStatus.PENDING);

    res.status(201).json({
      success: true,
      data: {
        ...updatedOrder,
        estimatedCost,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/orders - List orders with filters
router.get('/', validateQuery(orderFiltersSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filters = {
      ...req.query,
      startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
      endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      offset: req.query.offset ? parseInt(req.query.offset as string) : undefined,
    };

    const result = await orderService.getOrders(filters);

    res.json({
      success: true,
      data: result.orders,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/orders/:id - Get order details
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await orderService.getOrderById(req.params.id);

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/v1/orders/:id - Update order status
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status } = req.body;

    if (!Object.values(OrderStatus).includes(status)) {
      return next(createError('Invalid order status', 400));
    }

    const order = await orderService.updateOrderStatus(req.params.id, status);

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/orders/:id/assign - Assign transporter to order
router.post('/:id/assign', validateRequest(assignTransporterSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { transporterId } = req.body;
    const order = await orderService.assignTransporter(req.params.id, transporterId);

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/orders/:id - Cancel order
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await orderService.cancelOrder(req.params.id);

    res.json({
      success: true,
      data: order,
      message: 'Order cancelled successfully',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/orders/estimate - Calculate cost estimate
router.post('/estimate', validateRequest(createOrderSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderData: CreateOrderData = {
      ...req.body,
      pickupTime: new Date(req.body.pickupTime),
      deliveryTime: req.body.deliveryTime ? new Date(req.body.deliveryTime) : undefined,
    };

    const estimatedCost = await orderService.calculateEstimatedCost(orderData);

    res.json({
      success: true,
      data: {
        estimatedCost,
        currency: 'USD',
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;