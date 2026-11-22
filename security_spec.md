# RiderGuard Firestore Security Specification

## 1. Data Invariants
1. **Rider Identity & Role Isolation**: A rider can only create and manage their own `/riders/{riderId}` profile with `role == 'rider'`. Riders cannot self-assign `role == 'admin'` or mutate `role`, `uid`, or `createdAt`.
2. **PII & Medical Vault Isolation**: `/riders/{riderId}/medical/record` contains sensitive medical history and AES-GCM encrypted Aadhaar ciphertext (never plaintext Aadhaar). Read and write access is strictly confined to the owner rider or verified admins, and requires the parent `/riders/{riderId}` document to exist.
3. **Owned Sub-Resources**: `/bikes/{bikeId}`, `/emergencyContacts/{contactId}`, `/accidents/{accidentId}`, `/notifications/{notificationId}`, `/liveSessions/{sessionId}`, and `/deviceStatuses/{riderId}` strictly bind `riderId == request.auth.uid` on create and keep `riderId` and `createdAt` immutable.
4. **Accident Terminal State Locking**: Once an `/accidents/{accidentId}` record reaches `RESOLVED` or `CANCELLED_FALSE_ALARM`, riders cannot mutate its state further (only verified admins may correct administrative records).
5. **Scoped Live Location Sharing**: `/liveSessions/{sessionId}` allows single-document `get` via a high-entropy token (`sessionId.size() >= 24`) ONLY while `isActive == true`. Once closed (`isActive == false`), external link access is immediately revoked. Collection `list` queries are strictly restricted to owner or admin.
6. **Verified Auth & Server Timestamps**: All writes require verified authentication (`email_verified == true`) and enforce `createdAt == request.time` on create and `updatedAt == request.time` on update.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Self-Admin Escalation**: `POST /riders/{uid}` with `{ role: "admin", ... }` by a non-admin user.
2. **Role Mutation on Update**: `PATCH /riders/{uid}` changing `role` from `"rider"` to `"admin"`.
3. **Shadow/Ghost Field Injection**: `POST /bikes/{id}` including an undeclared field `isVerified: true`.
4. **Cross-Rider Medical Vault Snooping**: `GET /riders/{victimUid}/medical/record` authenticated as `{attackerUid}`.
5. **Cross-Rider Contact Hijacking**: `POST /emergencyContacts/{id}` with `riderId: "{victimUid}"` by `{attackerUid}`.
6. **Oversized String Resource Poisoning**: `POST /bikes/{id}` with `brand` exceeding 60 characters or `bikeId` exceeding 128 characters.
7. **Unverified Email Spoofing**: Request claiming admin email with `email_verified: false`.
8. **Timestamp Forgery**: `POST /accidents/{id}` supplying a backdated `createdAt` not equal to `request.time`.
9. **Terminal Accident Tampering**: `PATCH /accidents/{id}` modifying a `RESOLVED` accident record as a rider.
10. **Closed Live Session Access**: `GET /liveSessions/{token}` when `isActive == false` by a non-owner.
11. **Unauthorized Hospital Modification**: `POST /hospitals/{id}` or `DELETE /hospitals/{id}` by a standard rider.
12. **Blanket Collection Scraping**: `LIST /accidents` or `LIST /emergencyContacts` without filtering `where("riderId", "==", uid)` as a non-admin rider.
