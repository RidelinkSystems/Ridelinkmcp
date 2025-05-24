import { Order, OrderStatus, Prisma } from '@prisma/client';
import prisma from '@/config/database';
import { createError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';

export interface CreateOrderData {
  customerId: string;
  pickupLocation: {
    latitude: number;
    longitude: number;
    address: string;
  };
  deliveryLocation: {
    latitude: number;
    longitude: number;
    address: string;
  };
  pickupTime: Date;
  deliveryTime?: Date;
  weight: number;
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  specialRequirements?: string;
}

export interface OrderFilters {
  status?: OrderStatus;
  customerId?: string;
  transporterId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export class OrderService {
  async createOrder(data: CreateOrderData): Promise<Order> {
    try {
      logger.info('Creating new order', { customerId: data.customerId });

      const order = await prisma.order.create({
        data: {
          customerId: data.customerId,
          pickupLocation: data.pickupLocation,
          deliveryLocation: data.deliveryLocation,
          pickupTime: data.pickupTime,
          deliveryTime: data.deliveryTime,
          weight: data.weight,
          dimensions: data.dimensions,
          specialRequirements: data.specialRequirements,
          status: OrderStatus.PENDING,
        },
        include: {
          transporter: true,
          route: true,
        },
      });

      logger.info('Order created successfully', { orderId: order.id });
      return order;
    } catch (error) {
      logger.error('Failed to create order', { error, data });
      throw createError('Failed to create order', 500);
    }
  }

  async getOrders(filters: OrderFilters = {}) {
    try {
      const where: Prisma.OrderWhereInput = {};

      if (filters.status) where.status = filters.status;
      if (filters.customerId) where.customerId = filters.customerId;
      if (filters.transporterId) where.transporterId = filters.transporterId;
      
      if (filters.startDate || filters.endDate) {
        where.createdAt = {};
        if (filters.startDate) where.createdAt.gte = filters.startDate;
        if (filters.endDate) where.createdAt.lte = filters.endDate;
      }

      const orders = await prisma.order.findMany({
        where,
        include: {
          transporter: true,
          route: true,
        },
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 50,
        skip: filters.offset || 0,
      });

      const total = await prisma.order.count({ where });

      return {
        orders,
        pagination: {
          total,
          limit: filters.limit || 50,
          offset: filters.offset || 0,
        },
      };
    } catch (error) {
      logger.error('Failed to fetch orders', { error, filters });
      throw createError('Failed to fetch orders', 500);
    }
  }

  async getOrderById(id: string): Promise<Order> {
    try {
      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          transporter: true,
          route: true,
          trackingData: true,
          matchingHistory: {
            include: {
              transporter: true,
            },
          },
        },
      });

      if (!order) {
        throw createError('Order not found', 404);
      }

      return order;
    } catch (error) {
      if (error instanceof Error && error.message === 'Order not found') {
        throw error;
      }
      logger.error('Failed to fetch order', { error, orderId: id });
      throw createError('Failed to fetch order', 500);
    }
  }

  async updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
    try {
      const order = await prisma.order.update({
        where: { id },
        data: { 
          status,
          updatedAt: new Date(),
        },
        include: {
          transporter: true,
          route: true,
        },
      });

      logger.info('Order status updated', { orderId: id, status });
      return order;
    } catch (error) {
      logger.error('Failed to update order status', { error, orderId: id, status });
      throw createError('Failed to update order status', 500);
    }
  }

  async assignTransporter(orderId: string, transporterId: string): Promise<Order> {
    try {
      const order = await prisma.order.update({
        where: { id: orderId },
        data: {
          transporterId,
          status: OrderStatus.ASSIGNED,
          updatedAt: new Date(),
        },
        include: {
          transporter: true,
          route: true,
        },
      });

      logger.info('Transporter assigned to order', { orderId, transporterId });
      return order;
    } catch (error) {
      logger.error('Failed to assign transporter', { error, orderId, transporterId });
      throw createError('Failed to assign transporter', 500);
    }
  }

  async cancelOrder(id: string): Promise<Order> {
    try {
      const order = await this.getOrderById(id);

      if (order.status === OrderStatus.DELIVERED) {
        throw createError('Cannot cancel delivered order', 400);
      }

      if (order.status === OrderStatus.IN_TRANSIT) {
        throw createError('Cannot cancel order in transit', 400);
      }

      const updatedOrder = await prisma.order.update({
        where: { id },
        data: {
          status: OrderStatus.CANCELLED,
          updatedAt: new Date(),
        },
        include: {
          transporter: true,
          route: true,
        },
      });

      logger.info('Order cancelled', { orderId: id });
      return updatedOrder;
    } catch (error) {
      if (error instanceof Error && (error as any).statusCode) {
        throw error;
      }
      logger.error('Failed to cancel order', { error, orderId: id });
      throw createError('Failed to cancel order', 500);
    }
  }

  async calculateEstimatedCost(orderData: CreateOrderData): Promise<number> {
    const baseRate = 5.0; // Base rate per km
    const weightMultiplier = 0.5; // Additional rate per kg
    const timeMultiplier = 1.2; // Peak time multiplier

    // Calculate distance (simplified - would use actual routing service)
    const distance = this.calculateDistance(
      orderData.pickupLocation,
      orderData.deliveryLocation
    );

    const baseCost = distance * baseRate;
    const weightCost = orderData.weight * weightMultiplier;
    const totalCost = baseCost + weightCost;

    // Apply time-based pricing
    const pickupHour = orderData.pickupTime.getHours();
    const isPeakTime = (pickupHour >= 7 && pickupHour <= 9) || (pickupHour >= 17 && pickupHour <= 19);
    
    return isPeakTime ? totalCost * timeMultiplier : totalCost;
  }

  private calculateDistance(point1: { latitude: number; longitude: number }, point2: { latitude: number; longitude: number }): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRadians(point2.latitude - point1.latitude);
    const dLon = this.toRadians(point2.longitude - point1.longitude);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(point1.latitude)) * Math.cos(this.toRadians(point2.latitude)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}

export const orderService = new OrderService();