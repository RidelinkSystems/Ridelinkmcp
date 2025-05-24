import { Transporter, TransporterStatus, VehicleType, Prisma } from '@prisma/client';
import prisma from '@/config/database';
import { createError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';

export interface CreateTransporterData {
  name: string;
  licenseNumber: string;
  phoneNumber: string;
  email: string;
  vehicleType: VehicleType;
  capacityWeight: number;
  capacityVolume: number;
}

export interface UpdateTransporterData {
  name?: string;
  phoneNumber?: string;
  email?: string;
  vehicleType?: VehicleType;
  capacityWeight?: number;
  capacityVolume?: number;
  currentLocation?: {
    latitude: number;
    longitude: number;
  };
  availabilityStatus?: TransporterStatus;
}

export interface TransporterFilters {
  status?: TransporterStatus;
  vehicleType?: VehicleType;
  isVerified?: boolean;
  nearLocation?: {
    latitude: number;
    longitude: number;
    radiusKm: number;
  };
  minCapacityWeight?: number;
  minCapacityVolume?: number;
  limit?: number;
  offset?: number;
}

export class TransporterService {
  async createTransporter(data: CreateTransporterData): Promise<Transporter> {
    try {
      // Check if license number already exists
      const existingLicense = await prisma.transporter.findUnique({
        where: { licenseNumber: data.licenseNumber },
      });

      if (existingLicense) {
        throw createError('License number already registered', 400);
      }

      // Check if email already exists
      const existingEmail = await prisma.transporter.findUnique({
        where: { email: data.email },
      });

      if (existingEmail) {
        throw createError('Email already registered', 400);
      }

      logger.info('Creating new transporter', { email: data.email });

      const transporter = await prisma.transporter.create({
        data: {
          name: data.name,
          licenseNumber: data.licenseNumber,
          phoneNumber: data.phoneNumber,
          email: data.email,
          vehicleType: data.vehicleType,
          capacityWeight: data.capacityWeight,
          capacityVolume: data.capacityVolume,
          availabilityStatus: TransporterStatus.AVAILABLE,
          isVerified: false,
        },
      });

      logger.info('Transporter created successfully', { transporterId: transporter.id });
      return transporter;
    } catch (error) {
      if (error instanceof Error && (error as any).statusCode) {
        throw error;
      }
      logger.error('Failed to create transporter', { error, data });
      throw createError('Failed to create transporter', 500);
    }
  }

  async getTransporters(filters: TransporterFilters = {}) {
    try {
      const where: Prisma.TransporterWhereInput = {};

      if (filters.status) where.availabilityStatus = filters.status;
      if (filters.vehicleType) where.vehicleType = filters.vehicleType;
      if (filters.isVerified !== undefined) where.isVerified = filters.isVerified;
      if (filters.minCapacityWeight) where.capacityWeight = { gte: filters.minCapacityWeight };
      if (filters.minCapacityVolume) where.capacityVolume = { gte: filters.minCapacityVolume };

      let transporters = await prisma.transporter.findMany({
        where,
        include: {
          orders: {
            where: {
              status: { in: ['ASSIGNED', 'IN_TRANSIT'] },
            },
          },
          _count: {
            select: {
              orders: true,
              routes: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 50,
        skip: filters.offset || 0,
      });

      // Filter by location if specified
      if (filters.nearLocation) {
        transporters = transporters.filter(transporter => {
          if (!transporter.currentLocation) return false;
          
          const location = transporter.currentLocation as any;
          const distance = this.calculateDistance(
            filters.nearLocation!,
            { latitude: location.latitude, longitude: location.longitude }
          );
          
          return distance <= filters.nearLocation!.radiusKm;
        });
      }

      const total = await prisma.transporter.count({ where });

      return {
        transporters,
        pagination: {
          total,
          limit: filters.limit || 50,
          offset: filters.offset || 0,
        },
      };
    } catch (error) {
      logger.error('Failed to fetch transporters', { error, filters });
      throw createError('Failed to fetch transporters', 500);
    }
  }

  async getTransporterById(id: string): Promise<Transporter> {
    try {
      const transporter = await prisma.transporter.findUnique({
        where: { id },
        include: {
          orders: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
          routes: {
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
          trackingData: {
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
          _count: {
            select: {
              orders: true,
              routes: true,
            },
          },
        },
      });

      if (!transporter) {
        throw createError('Transporter not found', 404);
      }

      return transporter;
    } catch (error) {
      if (error instanceof Error && error.message === 'Transporter not found') {
        throw error;
      }
      logger.error('Failed to fetch transporter', { error, transporterId: id });
      throw createError('Failed to fetch transporter', 500);
    }
  }

  async updateTransporter(id: string, data: UpdateTransporterData): Promise<Transporter> {
    try {
      // Check if email is being updated and already exists
      if (data.email) {
        const existingEmail = await prisma.transporter.findFirst({
          where: {
            email: data.email,
            id: { not: id },
          },
        });

        if (existingEmail) {
          throw createError('Email already registered', 400);
        }
      }

      const transporter = await prisma.transporter.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
        include: {
          orders: {
            where: {
              status: { in: ['ASSIGNED', 'IN_TRANSIT'] },
            },
          },
        },
      });

      logger.info('Transporter updated successfully', { transporterId: id });
      return transporter;
    } catch (error) {
      if (error instanceof Error && (error as any).statusCode) {
        throw error;
      }
      logger.error('Failed to update transporter', { error, transporterId: id, data });
      throw createError('Failed to update transporter', 500);
    }
  }

  async updateStatus(id: string, status: TransporterStatus): Promise<Transporter> {
    try {
      const transporter = await prisma.transporter.update({
        where: { id },
        data: {
          availabilityStatus: status,
          updatedAt: new Date(),
        },
      });

      logger.info('Transporter status updated', { transporterId: id, status });
      return transporter;
    } catch (error) {
      logger.error('Failed to update transporter status', { error, transporterId: id, status });
      throw createError('Failed to update transporter status', 500);
    }
  }

  async updateLocation(id: string, location: { latitude: number; longitude: number }): Promise<void> {
    try {
      await prisma.transporter.update({
        where: { id },
        data: {
          currentLocation: location,
          updatedAt: new Date(),
        },
      });

      // Also store in tracking data
      await prisma.trackingData.create({
        data: {
          transporterId: id,
          latitude: location.latitude,
          longitude: location.longitude,
          timestamp: new Date(),
        },
      });

      logger.debug('Transporter location updated', { transporterId: id, location });
    } catch (error) {
      logger.error('Failed to update transporter location', { error, transporterId: id, location });
      throw createError('Failed to update location', 500);
    }
  }

  async getAvailableTransporters(filters: {
    vehicleType?: VehicleType;
    minCapacityWeight?: number;
    minCapacityVolume?: number;
    nearLocation?: {
      latitude: number;
      longitude: number;
      radiusKm: number;
    };
  } = {}) {
    return this.getTransporters({
      ...filters,
      status: TransporterStatus.AVAILABLE,
      isVerified: true,
    });
  }

  async getTransporterOrders(transporterId: string, limit = 20, offset = 0) {
    try {
      const orders = await prisma.order.findMany({
        where: { transporterId },
        include: {
          route: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      });

      const total = await prisma.order.count({
        where: { transporterId },
      });

      return {
        orders,
        pagination: {
          total,
          limit,
          offset,
        },
      };
    } catch (error) {
      logger.error('Failed to fetch transporter orders', { error, transporterId });
      throw createError('Failed to fetch transporter orders', 500);
    }
  }

  async updateRating(transporterId: string, newRating: number): Promise<void> {
    try {
      const transporter = await this.getTransporterById(transporterId);
      const currentRating = transporter.rating;
      const totalDeliveries = transporter.totalDeliveries;

      // Calculate new average rating
      const updatedRating = ((currentRating * totalDeliveries) + newRating) / (totalDeliveries + 1);

      await prisma.transporter.update({
        where: { id: transporterId },
        data: {
          rating: Math.round(updatedRating * 100) / 100, // Round to 2 decimal places
          totalDeliveries: totalDeliveries + 1,
        },
      });

      logger.info('Transporter rating updated', { transporterId, newRating, updatedRating });
    } catch (error) {
      logger.error('Failed to update transporter rating', { error, transporterId, newRating });
      throw createError('Failed to update rating', 500);
    }
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

export const transporterService = new TransporterService();