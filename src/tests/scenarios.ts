import type {
  DashboardAnalytics,
  PaginatedProperties,
  PropertyDetail,
  PropertyListing,
  UserSummary,
} from "@/types";

import { assert, assertEqual, assertIncludes, assertObject } from "./assert";
import { apiRequest, createTextUploadForm } from "./test-client";

type AuthResponse = { user: UserSummary; token: string };
type ErrorResponse = { error?: string };
type BidHistory = {
  id: string;
  amount: number;
  createdAt: string;
  status: string;
  property: { id: string; title: string; images: string[]; currentPrice: number; status: string };
};

type SmokeContext = {
  adminToken: string;
  customerToken: string;
  activeProperty: PropertyListing;
  uploadedImageUrl?: string;
  tempPropertyId?: string;
};

export async function runAuthChecks() {
  const adminLogin = await apiRequest<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: { email: "admin@auction.local", password: "Password123!" },
  });
  assert(adminLogin.ok, "Admin login should succeed");
  assertEqual(adminLogin.data.user.role, "ADMIN", "Admin role should be ADMIN");

  const customerLogin = await apiRequest<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: { email: "fatima@auction.local", password: "Password123!" },
  });
  assert(customerLogin.ok, "Customer login should succeed");
  assertEqual(customerLogin.data.user.role, "CUSTOMER", "Customer role should be CUSTOMER");

  const invalidLogin = await apiRequest<ErrorResponse>("/api/auth/login", {
    method: "POST",
    body: { email: "fatima@auction.local", password: "WrongPass123!" },
  });
  assertEqual(invalidLogin.status, 401, "Invalid password should be rejected");

  const me = await apiRequest<{ user: UserSummary }>("/api/auth/me", { token: customerLogin.data.token });
  assert(me.ok, "Auth me route should succeed with token");
  assertEqual(me.data.user.email, "fatima@auction.local", "Auth me should return current customer");

  const meUnauthorized = await apiRequest<ErrorResponse>("/api/auth/me");
  assertEqual(meUnauthorized.status, 401, "Auth me should fail without token");

  return {
    adminToken: adminLogin.data.token,
    customerToken: customerLogin.data.token,
  };
}

export async function runBrowseAndBidChecks(context: SmokeContext) {
  const properties = await apiRequest<PaginatedProperties>("/api/properties");
  assert(properties.ok, "Property listing route should succeed");
  assert(properties.data.items.length > 0, "Properties should not be empty");

  assertIncludes(
    properties.data.items,
    (property) => property.status === "ACTIVE",
    "At least one active property should exist",
  );

  const searchResult = await apiRequest<PaginatedProperties>("/api/properties?search=Dubai");
  assert(searchResult.ok, "Property search should succeed");
  assert(
    searchResult.data.items.every(
      (property) =>
        property.city.includes("Dubai") ||
        property.location.includes("Dubai") ||
        property.title.includes("Dubai"),
    ),
    "Search result should only include matching Dubai properties",
  );

  const activeProperty = properties.data.items.find((property) => property.status === "ACTIVE");
  assert(activeProperty, "An active property is required for bidding checks");
  context.activeProperty = activeProperty;

  const detail = await apiRequest<PropertyDetail>(`/api/properties/${activeProperty.id}`);
  assert(detail.ok, "Property detail route should succeed");
  assert(Array.isArray(detail.data.bids), "Property detail should include bids array");

  const minimumBid = detail.data.currentPrice + detail.data.minimumIncrement;
  const rejectedBid = await apiRequest<ErrorResponse>(`/api/properties/${activeProperty.id}/bids`, {
    method: "POST",
    token: context.customerToken,
    body: { amount: minimumBid - 1 },
  });
  assertEqual(rejectedBid.status, 400, "Bid below minimum should be rejected");

  const validBid = await apiRequest<{ bid: { amount: number }; bidCount: number; auctionEnd: string }>(
    `/api/properties/${activeProperty.id}/bids`,
    {
      method: "POST",
      token: context.customerToken,
      body: { amount: minimumBid },
    },
  );
  assert(validBid.ok, "Valid bid should succeed");

  const updatedDetail = await apiRequest<PropertyDetail>(`/api/properties/${activeProperty.id}`);
  assert(updatedDetail.ok, "Updated property detail should succeed");
  assertEqual(updatedDetail.data.currentPrice, minimumBid, "Current price should update after valid bid");
  assert(updatedDetail.data.bidCount > detail.data.bidCount, "Bid count should increase after valid bid");
  assert(updatedDetail.data.bids[0]?.amount === minimumBid, "Latest bid amount should match placed bid");

  const myBids = await apiRequest<BidHistory[]>("/api/me/bids", { token: context.customerToken });
  assert(myBids.ok, "Customer bid history route should succeed");
  assertIncludes(
    myBids.data,
    (bid) => bid.property.id === activeProperty.id && bid.amount === minimumBid,
    "Customer bid history should include the newly placed bid",
  );
}

export async function runAdminChecks(context: SmokeContext) {
  const analytics = await apiRequest<DashboardAnalytics>("/api/admin/analytics", {
    token: context.adminToken,
  });
  assert(analytics.ok, "Admin analytics route should succeed");
  assertObject(analytics.data.totals, "Analytics totals should be present");
  assert(Array.isArray(analytics.data.bidsByDay), "Analytics should include bidsByDay");

  const analyticsForbidden = await apiRequest<ErrorResponse>("/api/admin/analytics", {
    token: context.customerToken,
  });
  assertEqual(analyticsForbidden.status, 403, "Customer should not access admin analytics");

  const upload = await apiRequest<{ files: string[] }>("/api/admin/upload", {
    method: "POST",
    token: context.adminToken,
    formData: createTextUploadForm("smoke-upload.txt", "panic auction smoke upload"),
  });
  assert(upload.ok, "Admin upload should succeed");
  assert(upload.data.files.length > 0, "Admin upload should return at least one file URL");
  context.uploadedImageUrl = upload.data.files[0];

  const timestamp = Date.now();
  const createPayload = {
    title: `Smoke Test Property ${timestamp}`,
    description: "Temporary property created by the smoke test script for CRUD verification.",
    propertyType: "Apartment",
    location: "Dubai Marina, Dubai",
    city: "Dubai",
    area: 1500,
    bedrooms: 2,
    bathrooms: 2,
    amenities: ["Pool", "Gym"],
    images: [context.uploadedImageUrl],
    startingPrice: 1000000,
    currentPrice: 1000000,
    minimumIncrement: 5000,
    auctionStart: new Date(Date.now() + 60_000).toISOString(),
    auctionEnd: new Date(Date.now() + 3600_000).toISOString(),
    status: "UPCOMING",
    latitude: 25.08,
    longitude: 55.14,
  };

  const created = await apiRequest<PropertyListing>("/api/admin/properties", {
    method: "POST",
    token: context.adminToken,
    body: createPayload,
  });
  assert(created.ok, "Admin property create should succeed");
  context.tempPropertyId = created.data.id;

  const publicDetail = await apiRequest<PropertyDetail>(`/api/properties/${created.data.id}`);
  assert(publicDetail.ok, "Created property should be retrievable publicly");

  const updatedTitle = `${createPayload.title} Updated`;
  const updated = await apiRequest<PropertyListing>(`/api/admin/properties/${created.data.id}`, {
    method: "PUT",
    token: context.adminToken,
    body: { ...createPayload, title: updatedTitle, currentPrice: 1010000 },
  });
  assert(updated.ok, "Admin property update should succeed");
  assertEqual(updated.data.title, updatedTitle, "Updated property title should persist");
}

export async function cleanupAdminArtifacts(context: SmokeContext) {
  if (!context.tempPropertyId) {
    return;
  }

  const deleted = await apiRequest<{ success: true }>(`/api/admin/properties/${context.tempPropertyId}`, {
    method: "DELETE",
    token: context.adminToken,
  });
  assert(deleted.ok, "Admin property delete should succeed");

  const missing = await apiRequest<ErrorResponse>(`/api/properties/${context.tempPropertyId}`);
  assertEqual(missing.status, 404, "Deleted property should no longer be retrievable");
}
