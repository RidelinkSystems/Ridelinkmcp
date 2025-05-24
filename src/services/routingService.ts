import { Route, RouteStatus } from '@prisma/client';
import prisma from '@/config/database';
import { createError } from '@/middleware/errorHandler';
import { logger } from '@/utils/logger';
import axios from 'axios';

export interface RouteWaypoint {
  latitude: number;
  longitude: number;
  address?: string;
  estimatedArrival?: Date;
}

export interface RouteOptimizationRequest {
  origin: RouteWaypoint;
  destination: RouteWaypoint;
  waypoints?: RouteWaypoint[];
  vehicleType: string;
  trafficModel?: 'best_guess' | 'pessimistic' | 'optimistic';
  departureTime?: Date;
}

export interface OptimizedRoute {
  path: RouteWaypoint[];
  totalDistance: number; // in km
  estimatedDuration: number; // in minutes
  estimatedFuelCost: number;
  estimatedTollCost: number;
  trafficConditions: string;
  waypoints: RouteWaypoint[];
}

export interface TrafficCondition {
  segment: {
    start: RouteWaypoint;
    end: RouteWaypoint;
  };
  condition: 'light' | 'moderate' | 'heavy' | 'severe';
  delay: number; // additional minutes
}

export class RoutingService {
  private readonly googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  private readonly mapboxToken = process.env.MAPBOX_ACCESS_TOKEN;

  async calculateOptimalRoute(request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    try {
      logger.info('Calculating optimal route', { 
        origin: request.origin, 
        destination: request.destination 
      });

      // Use external routing service (Google Maps or Mapbox)
      const routeData = await this.getExternalRoute(request);
      
      // Calculate costs
      const fuelCost = this.calculateFuelCost(routeData.totalDistance, request.vehicleType);
      const tollCost = await this.estimateTollCost(routeData.path);

      const optimizedRoute: OptimizedRoute = {
        path: routeData.path,
        totalDistance: routeData.totalDistance,
        estimatedDuration: routeData.estimatedDuration,
        estimatedFuelCost: fuelCost,
        estimatedTollCost: tollCost,
        trafficConditions: routeData.trafficConditions,
        waypoints: routeData.waypoints,
      };

      logger.info('Route calculation completed', {
        distance: optimizedRoute.totalDistance,
        duration: optimizedRoute.estimatedDuration,
        cost: optimizedRoute.estimatedFuelCost + optimizedRoute.estimatedTollCost
      });

      return optimizedRoute;
    } catch (error) {
      logger.error('Failed to calculate route', { error, request });
      throw createError('Failed to calculate optimal route', 500);
    }
  }

  async createRoute(orderId: string, transporterId: string, optimizationRequest: RouteOptimizationRequest): Promise<Route> {
    try {
      const optimizedRoute = await this.calculateOptimalRoute(optimizationRequest);

      const route = await prisma.route.create({
        data: {
          orderId,
          transporterId,
          optimizedPath: optimizedRoute.path,
          estimatedDuration: optimizedRoute.estimatedDuration,
          distance: optimizedRoute.totalDistance,
          fuelCost: optimizedRoute.estimatedFuelCost,
          tollCost: optimizedRoute.estimatedTollCost,
          status: RouteStatus.PLANNED,
        },
        include: {
          order: true,
          transporter: true,
        },
      });

      logger.info('Route created successfully', { routeId: route.id, orderId, transporterId });
      return route;
    } catch (error) {
      logger.error('Failed to create route', { error, orderId, transporterId });
      throw createError('Failed to create route', 500);
    }
  }

  async updateRouteStatus(routeId: string, status: RouteStatus, actualDuration?: number): Promise<Route> {
    try {
      const updateData: any = {
        status,
        updatedAt: new Date(),
      };

      if (actualDuration) {
        updateData.actualDuration = actualDuration;
      }

      const route = await prisma.route.update({
        where: { id: routeId },
        data: updateData,
        include: {
          order: true,
          transporter: true,
        },
      });

      logger.info('Route status updated', { routeId, status });
      return route;
    } catch (error) {
      logger.error('Failed to update route status', { error, routeId, status });
      throw createError('Failed to update route status', 500);
    }
  }

  async getRouteById(routeId: string): Promise<Route> {
    try {
      const route = await prisma.route.findUnique({
        where: { id: routeId },
        include: {
          order: true,
          transporter: true,
        },
      });

      if (!route) {
        throw createError('Route not found', 404);
      }

      return route;
    } catch (error) {
      if (error instanceof Error && error.message === 'Route not found') {
        throw error;
      }
      logger.error('Failed to fetch route', { error, routeId });
      throw createError('Failed to fetch route', 500);
    }
  }

  async optimizeMultipleDeliveries(transporterId: string, deliveryPoints: RouteWaypoint[]): Promise<OptimizedRoute> {
    try {
      logger.info('Optimizing multiple deliveries', { transporterId, deliveryCount: deliveryPoints.length });

      // Get transporter's current location
      const transporter = await prisma.transporter.findUnique({
        where: { id: transporterId },
      });

      if (!transporter || !transporter.currentLocation) {
        throw createError('Transporter location not available', 400);
      }

      const currentLocation = transporter.currentLocation as any;
      const origin: RouteWaypoint = {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
      };

      // Use TSP (Traveling Salesman Problem) algorithm to optimize order
      const optimizedOrder = await this.solveTSP(origin, deliveryPoints);

      const request: RouteOptimizationRequest = {
        origin,
        destination: optimizedOrder[optimizedOrder.length - 1],
        waypoints: optimizedOrder.slice(0, -1),
        vehicleType: transporter.vehicleType,
      };

      return await this.calculateOptimalRoute(request);
    } catch (error) {
      logger.error('Failed to optimize multiple deliveries', { error, transporterId });
      throw createError('Failed to optimize route', 500);
    }
  }

  async getRealTimeTrafficUpdate(routeId: string): Promise<TrafficCondition[]> {
    try {
      const route = await this.getRouteById(routeId);
      const routePath = route.optimizedPath as RouteWaypoint[];

      // Get real-time traffic data from external service
      const trafficData = await this.getTrafficData(routePath);

      return trafficData;
    } catch (error) {
      logger.error('Failed to get traffic update', { error, routeId });
      throw createError('Failed to get traffic update', 500);
    }
  }

  async recalculateRoute(routeId: string, currentLocation: RouteWaypoint): Promise<OptimizedRoute> {
    try {
      const route = await this.getRouteById(routeId);
      const originalPath = route.optimizedPath as RouteWaypoint[];
      
      // Find remaining waypoints
      const remainingWaypoints = this.getRemainingWaypoints(originalPath, currentLocation);

      if (remainingWaypoints.length === 0) {
        throw createError('Route already completed', 400);
      }

      const request: RouteOptimizationRequest = {
        origin: currentLocation,
        destination: remainingWaypoints[remainingWaypoints.length - 1],
        waypoints: remainingWaypoints.slice(0, -1),
        vehicleType: route.transporter.vehicleType,
      };

      const newRoute = await this.calculateOptimalRoute(request);

      // Update route in database
      await prisma.route.update({
        where: { id: routeId },
        data: {
          optimizedPath: newRoute.path,
          estimatedDuration: newRoute.estimatedDuration,
          distance: newRoute.totalDistance,
          fuelCost: newRoute.estimatedFuelCost,
          tollCost: newRoute.estimatedTollCost,
          updatedAt: new Date(),
        },
      });

      logger.info('Route recalculated', { routeId });
      return newRoute;
    } catch (error) {
      logger.error('Failed to recalculate route', { error, routeId });
      throw createError('Failed to recalculate route', 500);
    }
  }

  private async getExternalRoute(request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    if (this.googleMapsApiKey) {
      return await this.getGoogleMapsRoute(request);
    } else if (this.mapboxToken) {
      return await this.getMapboxRoute(request);
    } else {
      // Fallback to basic calculation
      return await this.getBasicRoute(request);
    }
  }

  private async getGoogleMapsRoute(request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    try {
      const waypoints = request.waypoints?.map(wp => `${wp.latitude},${wp.longitude}`).join('|') || '';
      
      const url = `https://maps.googleapis.com/maps/api/directions/json`;
      const params = {
        origin: `${request.origin.latitude},${request.origin.longitude}`,
        destination: `${request.destination.latitude},${request.destination.longitude}`,
        waypoints: waypoints ? `optimize:true|${waypoints}` : undefined,
        traffic_model: request.trafficModel || 'best_guess',
        departure_time: request.departureTime ? Math.floor(request.departureTime.getTime() / 1000) : 'now',
        key: this.googleMapsApiKey,
      };

      const response = await axios.get(url, { params });
      const route = response.data.routes[0];

      return {
        path: this.parseGoogleMapsPath(route.legs),
        totalDistance: route.legs.reduce((sum: number, leg: any) => sum + leg.distance.value, 0) / 1000,
        estimatedDuration: route.legs.reduce((sum: number, leg: any) => sum + leg.duration.value, 0) / 60,
        estimatedFuelCost: 0,
        estimatedTollCost: 0,
        trafficConditions: route.legs[0]?.duration_in_traffic ? 'real-time' : 'estimated',
        waypoints: request.waypoints || [],
      };
    } catch (error) {
      logger.error('Google Maps API error', { error });
      throw createError('Failed to get route from Google Maps', 500);
    }
  }

  private async getMapboxRoute(request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    try {
      const coordinates = [
        `${request.origin.longitude},${request.origin.latitude}`,
        ...(request.waypoints?.map(wp => `${wp.longitude},${wp.latitude}`) || []),
        `${request.destination.longitude},${request.destination.latitude}`,
      ].join(';');

      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}`;
      const params = {
        access_token: this.mapboxToken,
        overview: 'full',
        geometries: 'geojson',
        steps: true,
      };

      const response = await axios.get(url, { params });
      const route = response.data.routes[0];

      return {
        path: this.parseMapboxPath(route.geometry.coordinates),
        totalDistance: route.distance / 1000,
        estimatedDuration: route.duration / 60,
        estimatedFuelCost: 0,
        estimatedTollCost: 0,
        trafficConditions: 'estimated',
        waypoints: request.waypoints || [],
      };
    } catch (error) {
      logger.error('Mapbox API error', { error });
      throw createError('Failed to get route from Mapbox', 500);
    }
  }

  private async getBasicRoute(request: RouteOptimizationRequest): Promise<OptimizedRoute> {
    // Basic straight-line distance calculation as fallback
    const distance = this.calculateDistance(request.origin, request.destination);
    const estimatedSpeed = 50; // km/h average
    const duration = (distance / estimatedSpeed) * 60; // minutes

    return {
      path: [request.origin, ...(request.waypoints || []), request.destination],
      totalDistance: distance,
      estimatedDuration: duration,
      estimatedFuelCost: 0,
      estimatedTollCost: 0,
      trafficConditions: 'estimated',
      waypoints: request.waypoints || [],
    };
  }

  private calculateDistance(point1: RouteWaypoint, point2: RouteWaypoint): number {
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

  private calculateFuelCost(distance: number, vehicleType: string): number {
    const fuelPrices = {
      MOTORCYCLE: 0.05, // per km
      CAR: 0.08,
      VAN: 0.12,
      TRUCK_SMALL: 0.15,
      TRUCK_MEDIUM: 0.20,
      TRUCK_LARGE: 0.25,
    };

    return distance * (fuelPrices[vehicleType as keyof typeof fuelPrices] || 0.10);
  }

  private async estimateTollCost(path: RouteWaypoint[]): Promise<number> {
    // Simplified toll estimation - would integrate with toll APIs in production
    const distance = path.reduce((total, point, index) => {
      if (index === 0) return 0;
      return total + this.calculateDistance(path[index - 1], point);
    }, 0);

    return distance > 50 ? distance * 0.02 : 0; // $0.02 per km for long routes
  }

  private async solveTSP(origin: RouteWaypoint, points: RouteWaypoint[]): Promise<RouteWaypoint[]> {
    // Simple nearest neighbor algorithm for TSP (would use more sophisticated algorithm in production)
    const unvisited = [...points];
    const result: RouteWaypoint[] = [];
    let current = origin;

    while (unvisited.length > 0) {
      let nearest = unvisited[0];
      let nearestIndex = 0;
      let minDistance = this.calculateDistance(current, nearest);

      for (let i = 1; i < unvisited.length; i++) {
        const distance = this.calculateDistance(current, unvisited[i]);
        if (distance < minDistance) {
          minDistance = distance;
          nearest = unvisited[i];
          nearestIndex = i;
        }
      }

      result.push(nearest);
      unvisited.splice(nearestIndex, 1);
      current = nearest;
    }

    return result;
  }

  private async getTrafficData(path: RouteWaypoint[]): Promise<TrafficCondition[]> {
    // Simulate traffic conditions - would integrate with real traffic APIs
    return path.slice(0, -1).map((point, index) => ({
      segment: {
        start: point,
        end: path[index + 1],
      },
      condition: Math.random() > 0.7 ? 'heavy' : 'light' as 'light' | 'heavy',
      delay: Math.random() > 0.7 ? Math.floor(Math.random() * 15) : 0,
    }));
  }

  private getRemainingWaypoints(originalPath: RouteWaypoint[], currentLocation: RouteWaypoint): RouteWaypoint[] {
    // Find the closest point on the route and return remaining waypoints
    let closestIndex = 0;
    let minDistance = this.calculateDistance(currentLocation, originalPath[0]);

    for (let i = 1; i < originalPath.length; i++) {
      const distance = this.calculateDistance(currentLocation, originalPath[i]);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = i;
      }
    }

    return originalPath.slice(closestIndex + 1);
  }

  private parseGoogleMapsPath(legs: any[]): RouteWaypoint[] {
    const path: RouteWaypoint[] = [];
    legs.forEach(leg => {
      leg.steps.forEach((step: any) => {
        path.push({
          latitude: step.start_location.lat,
          longitude: step.start_location.lng,
        });
      });
    });
    return path;
  }

  private parseMapboxPath(coordinates: number[][]): RouteWaypoint[] {
    return coordinates.map(coord => ({
      latitude: coord[1],
      longitude: coord[0],
    }));
  }
}

export const routingService = new RoutingService();