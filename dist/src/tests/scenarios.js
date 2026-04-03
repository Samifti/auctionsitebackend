"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAuthChecks = runAuthChecks;
exports.runBrowseAndBidChecks = runBrowseAndBidChecks;
exports.runAdminChecks = runAdminChecks;
exports.cleanupAdminArtifacts = cleanupAdminArtifacts;
const assert_1 = require("./assert");
const test_client_1 = require("./test-client");
async function runAuthChecks() {
    const adminLogin = await (0, test_client_1.apiRequest)("/api/auth/login", {
        method: "POST",
        body: { email: "admin@auction.local", password: "Password123!" },
    });
    (0, assert_1.assert)(adminLogin.ok, "Admin login should succeed");
    (0, assert_1.assertEqual)(adminLogin.data.user.role, "ADMIN", "Admin role should be ADMIN");
    const customerLogin = await (0, test_client_1.apiRequest)("/api/auth/login", {
        method: "POST",
        body: { email: "fatima@auction.local", password: "Password123!" },
    });
    (0, assert_1.assert)(customerLogin.ok, "Customer login should succeed");
    (0, assert_1.assertEqual)(customerLogin.data.user.role, "CUSTOMER", "Customer role should be CUSTOMER");
    const invalidLogin = await (0, test_client_1.apiRequest)("/api/auth/login", {
        method: "POST",
        body: { email: "fatima@auction.local", password: "WrongPass123!" },
    });
    (0, assert_1.assertEqual)(invalidLogin.status, 401, "Invalid password should be rejected");
    const me = await (0, test_client_1.apiRequest)("/api/auth/me", { token: customerLogin.data.token });
    (0, assert_1.assert)(me.ok, "Auth me route should succeed with token");
    (0, assert_1.assertEqual)(me.data.user.email, "fatima@auction.local", "Auth me should return current customer");
    const meUnauthorized = await (0, test_client_1.apiRequest)("/api/auth/me");
    (0, assert_1.assertEqual)(meUnauthorized.status, 401, "Auth me should fail without token");
    return {
        adminToken: adminLogin.data.token,
        customerToken: customerLogin.data.token,
    };
}
async function runBrowseAndBidChecks(context) {
    const properties = await (0, test_client_1.apiRequest)("/api/properties");
    (0, assert_1.assert)(properties.ok, "Property listing route should succeed");
    (0, assert_1.assert)(properties.data.items.length > 0, "Properties should not be empty");
    (0, assert_1.assertIncludes)(properties.data.items, (property) => property.status === "ACTIVE", "At least one active property should exist");
    const searchResult = await (0, test_client_1.apiRequest)("/api/properties?search=Dubai");
    (0, assert_1.assert)(searchResult.ok, "Property search should succeed");
    (0, assert_1.assert)(searchResult.data.items.every((property) => property.city.includes("Dubai") ||
        property.location.includes("Dubai") ||
        property.title.includes("Dubai")), "Search result should only include matching Dubai properties");
    const activeProperty = properties.data.items.find((property) => property.status === "ACTIVE");
    (0, assert_1.assert)(activeProperty, "An active property is required for bidding checks");
    context.activeProperty = activeProperty;
    const detail = await (0, test_client_1.apiRequest)(`/api/properties/${activeProperty.id}`);
    (0, assert_1.assert)(detail.ok, "Property detail route should succeed");
    (0, assert_1.assert)(Array.isArray(detail.data.bids), "Property detail should include bids array");
    const minimumBid = detail.data.currentPrice + detail.data.minimumIncrement;
    const rejectedBid = await (0, test_client_1.apiRequest)(`/api/properties/${activeProperty.id}/bids`, {
        method: "POST",
        token: context.customerToken,
        body: { amount: minimumBid - 1 },
    });
    (0, assert_1.assertEqual)(rejectedBid.status, 400, "Bid below minimum should be rejected");
    const validBid = await (0, test_client_1.apiRequest)(`/api/properties/${activeProperty.id}/bids`, {
        method: "POST",
        token: context.customerToken,
        body: { amount: minimumBid },
    });
    (0, assert_1.assert)(validBid.ok, "Valid bid should succeed");
    const updatedDetail = await (0, test_client_1.apiRequest)(`/api/properties/${activeProperty.id}`);
    (0, assert_1.assert)(updatedDetail.ok, "Updated property detail should succeed");
    (0, assert_1.assertEqual)(updatedDetail.data.currentPrice, minimumBid, "Current price should update after valid bid");
    (0, assert_1.assert)(updatedDetail.data.bidCount > detail.data.bidCount, "Bid count should increase after valid bid");
    (0, assert_1.assert)(updatedDetail.data.bids[0]?.amount === minimumBid, "Latest bid amount should match placed bid");
    const myBids = await (0, test_client_1.apiRequest)("/api/me/bids", { token: context.customerToken });
    (0, assert_1.assert)(myBids.ok, "Customer bid history route should succeed");
    (0, assert_1.assertIncludes)(myBids.data, (bid) => bid.property.id === activeProperty.id && bid.amount === minimumBid, "Customer bid history should include the newly placed bid");
}
async function runAdminChecks(context) {
    const analytics = await (0, test_client_1.apiRequest)("/api/admin/analytics", {
        token: context.adminToken,
    });
    (0, assert_1.assert)(analytics.ok, "Admin analytics route should succeed");
    (0, assert_1.assertObject)(analytics.data.totals, "Analytics totals should be present");
    (0, assert_1.assert)(Array.isArray(analytics.data.bidsByDay), "Analytics should include bidsByDay");
    const analyticsForbidden = await (0, test_client_1.apiRequest)("/api/admin/analytics", {
        token: context.customerToken,
    });
    (0, assert_1.assertEqual)(analyticsForbidden.status, 403, "Customer should not access admin analytics");
    const upload = await (0, test_client_1.apiRequest)("/api/admin/upload", {
        method: "POST",
        token: context.adminToken,
        formData: (0, test_client_1.createTextUploadForm)("smoke-upload.txt", "panic auction smoke upload"),
    });
    (0, assert_1.assert)(upload.ok, "Admin upload should succeed");
    (0, assert_1.assert)(upload.data.files.length > 0, "Admin upload should return at least one file URL");
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
        auctionStart: new Date(Date.now() + 60000).toISOString(),
        auctionEnd: new Date(Date.now() + 3600000).toISOString(),
        status: "UPCOMING",
        latitude: 25.08,
        longitude: 55.14,
    };
    const created = await (0, test_client_1.apiRequest)("/api/admin/properties", {
        method: "POST",
        token: context.adminToken,
        body: createPayload,
    });
    (0, assert_1.assert)(created.ok, "Admin property create should succeed");
    context.tempPropertyId = created.data.id;
    const publicDetail = await (0, test_client_1.apiRequest)(`/api/properties/${created.data.id}`);
    (0, assert_1.assert)(publicDetail.ok, "Created property should be retrievable publicly");
    const updatedTitle = `${createPayload.title} Updated`;
    const updated = await (0, test_client_1.apiRequest)(`/api/admin/properties/${created.data.id}`, {
        method: "PUT",
        token: context.adminToken,
        body: { ...createPayload, title: updatedTitle, currentPrice: 1010000 },
    });
    (0, assert_1.assert)(updated.ok, "Admin property update should succeed");
    (0, assert_1.assertEqual)(updated.data.title, updatedTitle, "Updated property title should persist");
}
async function cleanupAdminArtifacts(context) {
    if (!context.tempPropertyId) {
        return;
    }
    const deleted = await (0, test_client_1.apiRequest)(`/api/admin/properties/${context.tempPropertyId}`, {
        method: "DELETE",
        token: context.adminToken,
    });
    (0, assert_1.assert)(deleted.ok, "Admin property delete should succeed");
    const missing = await (0, test_client_1.apiRequest)(`/api/properties/${context.tempPropertyId}`);
    (0, assert_1.assertEqual)(missing.status, 404, "Deleted property should no longer be retrievable");
}
