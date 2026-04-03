export type UserRole = "ADMIN" | "CUSTOMER";

export type AuctionStatus = "UPCOMING" | "ACTIVE" | "ENDED" | "SOLD";

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
}

export interface BidActivity {
  id: string;
  amount: number;
  bidderName: string;
  createdAt: string;
  status: string;
}

export interface PropertyListing {
  id: string;
  title: string;
  description: string;
  propertyType: string;
  location: string;
  city: string;
  area: number;
  bedrooms: number | null;
  bathrooms: number | null;
  amenities: string[];
  images: string[];
  startingPrice: number;
  currentPrice: number;
  minimumIncrement: number;
  auctionStart: string;
  auctionEnd: string;
  status: AuctionStatus;
  latitude: number | null;
  longitude: number | null;
  bidCount: number;
  createdAt: string;
  updatedAt: string;
  /** Present when the request is authenticated (e.g. property search). */
  isFavorite?: boolean;
}

export interface AuctionWinner {
  userId: string;
  name: string;
  amount: number;
}

export interface PropertyDetail extends PropertyListing {
  bids: BidActivity[];
  winner: AuctionWinner | null;
}

export interface PaginatedProperties {
  items: PropertyListing[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DashboardAnalytics {
  totals: {
    totalProperties: number;
    activeAuctions: number;
    totalBids: number;
    totalValue: number;
  };
  bidsByDay: { day: string; bids: number }[];
  topProperties: { title: string; bids: number }[];
  statusDistribution: { status: AuctionStatus; count: number }[];
  recentBids: {
    id: string;
    amount: number;
    createdAt: string;
    propertyTitle: string;
    bidderName: string;
  }[];
}

export interface AuthResponse {
  user: UserSummary;
  token: string;
  /** Omitted when tokens are only set via httpOnly cookies. */
  refreshToken?: string;
}
