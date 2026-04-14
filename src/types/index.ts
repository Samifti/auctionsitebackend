export type UserRole = "ADMIN" | "CUSTOMER";

export type AuctionStatus = "UPCOMING" | "ACTIVE" | "ENDED" | "SOLD";

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  role: UserRole;
  emailVerified: boolean;
  phoneVerified: boolean;
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
    userId: string;
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

/**
 * A single bid entry as returned by the admin bids list endpoint.
 * Includes a snapshot of the bidder and the property being bid on.
 */
export interface AdminBidRecord {
  id: string;
  amount: number;
  /** String representation of the `BidStatus` enum value (e.g. "ACTIVE", "WON", "OUTBID"). */
  status: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    emailVerified: boolean;
    createdAt: string;
  };
  property: {
    id: string;
    title: string;
  };
}

/** Paginated wrapper for the admin bids list. */
export interface PaginatedAdminBids {
  items: AdminBidRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Safe user profile returned to admins.
 * Never includes `passwordHash` or token records.
 */
export interface AdminUserProfile {
  id: string;
  name: string;
  email: string;
  phoneNumber: string;
  role: UserRole;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
  updatedAt: string;
  /** Total number of bids ever placed by this user across all properties. */
  totalBids: number;
}
