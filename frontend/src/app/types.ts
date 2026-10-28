export type AccommodationRequirement = 'REQUIRED' | 'NO_ROOM';
export interface AccommodationRequirementFields { accommodationRequirement?: AccommodationRequirement; accommodationRequirementSource?: 'DEFAULT' | 'IMPORT' | 'MANUAL'; }
export type AccommodationRateCategory = 'STANDARD' | 'SPECIAL';
export interface AccommodationRateFields { accommodationRateCategory?: AccommodationRateCategory; accommodationRateSource?: 'DEFAULT' | 'MANUAL' | 'APPROVAL'; accommodationRateApprovalId?: number; accommodationRateApprovalIds?: number[]; accommodationRateExplanation?: string; }
export interface RoomType {
  id: string;
  name: string;
  maxPersons: number;
}

export interface AuthenticatedUser {
  isSuperadmin?: boolean;
  username: string;
  displayName: string;
  email: string;
  groups: string[];
  permissions: string[];
}

export type EventAccessLevel = 'NONE' | 'READ' | 'WRITE';
export interface KnownUser {
  username: string; displayName: string; groups: string[] | null; lastSeenAt: string | null;
  isSuperadmin: boolean; grants: Record<string, EventAccessLevel>; revision: string;
}
export interface UserAccessOverview {
  users: KnownUser[]; events: { id: string; name: string; active: boolean }[]; history: AuditEvent[];
}

export interface AuditEvent {
  id: string;
  createdAt: string;
  username: string;
  displayName: string;
  action: string;
  entityType: string;
  entityId?: string;
  method: string;
  path: string;
  changes?: Record<string, unknown>;
  /** Presentation-ready business semantics recorded when the change occurred. */
  activity?: string;
  category?: 'Import' | 'Disposition' | 'Hotels' | 'Stammdaten' | 'Entscheidungen';
  entityLabel?: string;
  // Historical text lists and structured import evidence share this wire field.
  // Validate at the presentation boundary rather than trusting an API cast.
  details?: unknown;
  entityRefs?: Record<string, string>;
}

export interface HotelRoomInventory {
  id: string;
  hotelId: string;
  roomType: RoomType;
  availableFrom: string; // ISO date
  availableUntil: string; // ISO date
  roomCount: number;
  hasHalfBoard?: boolean;
  hasSR?: boolean;
  comment?: string;
}

export interface Hotel {
  accommodationType?: 'STANDARD' | 'EXTERNAL';
  id: string;
  name: string;
  location?: string;
  region?: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  /** Hotel master-data note; distinct from comments on individual contingents. */
  comment?: string;
  roomInventories?: HotelRoomInventory[];
}

export interface EventRoomDemand {
  id: string;
  eventId: string;
  roomType: RoomType;
  roomCount: number;
}

export interface Event {
  id: string;
  discipline: string;
  startDate: string; // ISO date
  endDate: string; // ISO date
  personDemand: number;
  singleRoomPercentage: number;
  roomDemands?: EventRoomDemand[];
}

export interface Competition {
  id: string;
  importCode: string;
  code: string;
  name: string;
  displayName: string;
  sport: string;
  gender: string;
  teamCompetition: boolean;
  quotaDiscipline: string;
  active: boolean;
}

export interface EventCompetitionMapping {
  id: string; eventId: string; competitionId: string; fisCodex: string;
  importCode: string; officialName: string; active: boolean; displayName: string;
  sport: string; gender: string; quotaDiscipline: string; teamCompetition: boolean;
}

export type QuotaExtent = {total:number;M:number;F:number};
export interface QuotaRuleConfig {
  schemaVersion:1;
  athletes: Record<'Snowboard'|'Freestyle',{enabled:boolean;totalLimit:number;genderLimit:number}>;
  officials:{model:'ATHLETES_PLUS';allowance:number};
  singleRooms:Array<{upTo:number|null;rooms:number}>;
}
export interface EventQuotaRules {
  status:'DRAFT'|'FIXED';config:QuotaRuleConfig|null;digest:string;revision:number;fixedAt:string|null;fixedBy:string|null;
  eventId?:string;eventName?:string;isWorldChampionship?:boolean;
  preflight?:{counts:Record<string,number>;fingerprint:string;blockers:string[]};standardProposal?:QuotaRuleConfig;
  examples?:{athletes:number;officials:number;singleRooms:number;scale:string[];rows:Array<{name:string;used:number;covered:boolean;progress:number;label:string}>};
}
export interface ChampionshipEvent {
  id: string; name: string; year?: number; active: boolean;
  fisEventId?: string; sectorCode?: string;
  competitionMappings?: EventCompetitionMapping[];
  isWorldChampionship?:boolean;quotaRules?:EventQuotaRules;
}

export type SingleRoomStatus = 'NONE' | 'IN_QUOTA' | 'APPROVED_EXTRA' | 'PENDING_APPROVAL';
export type SingleRoomQuotaExemptReason = 'WORLD_CHAMPION' | 'OTHER' | null;

export interface AccommodationInterval {
  checkInDate: string | null;
  checkOutDate: string | null;
}
export interface AccommodationCoverage {
  overallInterval: AccommodationInterval;
  segments: Array<AccommodationInterval & {
    bookingId: string; hotelId: string; hotelName: string | null; accommodationType?: 'STANDARD' | 'EXTERNAL';
    roomTypeId: string | null; roomTypeName: string | null; roomNumber: string | null;
    countsAsSingle: boolean; conflictCodes: string[];
  }>;
  coveredIntervals: AccommodationInterval[];
  openIntervals: AccommodationInterval[];
  conflicts: Array<{code:string;bookingIds:string[]}>;
  accommodationRequirement?: AccommodationRequirement;
  coverageStatus: 'UNASSIGNED' | 'PARTIALLY_ASSIGNED' | 'FULLY_ASSIGNED' | 'CONFLICT' | 'NO_ROOM';
}

/** Read-only server assessment; allowedEnd is the exclusive checkout boundary. */
export interface StayWindow {
 eventStart:string|null;eventEnd:string|null;allowedStart:string|null;allowedEnd:string|null;
 arrivalDate:string|null;departureDate:string|null;nightsBefore:number|null;nightsAfter:number|null;
 outsideNights:number|null;reason:string|null;
}

export interface Athlete extends AccommodationRateFields, AccommodationRequirementFields {
  stayWindow?:StayWindow;
  accommodationCoverage?: AccommodationCoverage;
  id: string;
  function?: string;
  competitorId?: string;
  accredId?: string;
  fisCode?: string;
  sourceRecordIds?: string[];
  approvedQuotaDisciplines?: string[];
  approvedQuotaContexts?: Array<{ nationCode: string; discipline: string; gender: string }>;
  disciplines?: string[];
  competitions?: Competition[];
  stays?: Array<{ arrivalDate?: string | null; departureDate?: string | null; discipline?: string | null }>;
  lastname: string;
  firstname: string;
  nationCode: string;
  discipline?: string;
  gender?: string;
  forGender?: string;
  phone?: string;
  email?: string;
  present?: boolean;
  single_room_status: SingleRoomStatus;
  singleRoomQuotaExemptReason?: SingleRoomQuotaExemptReason;
  single_room_decision_id?: number | null;

  arrivalDate?: string | null; // ISO date
  arrivalTime?: string | null;
  arrivalBy?: string | null;
  arrivalAirport?: string | null;
  arrivalAirportName?: string | null;
  arrivalFlightno?: string | null;
  arrivalNeedTransportation?: boolean;
  departureDate?: string | null; // ISO date
  departureTime?: string | null;
  departureBy?: string | null;
  departureAirport?: string | null;
  departureAirportName?: string | null;
  departureFlightno?: string | null;
  departureNeedTransportation?: boolean;

  roomType?: string | null;
  sharedWithName?: string | null;
  lateCheckout?: boolean;
  firstMeal?: string | null;
  lastMeal?: string | null;
  specialMeal?: string | null;
  additionalItems?: string | null;
  internalNote?: string | null;
  tvPictureStatus?: string | null;
  tvPictureDate?: string | null;
  entryDate?: string | null;
  lastUpdate?: string | null;
  entriesSentDate?: string | null;
  stance?: string | null;

  athletesLastSeenAt?: string | null; // ISO datetime
  roomlistLastSeenAt?: string | null; // ISO datetime
  roomlistChangedAt?: string | null; // ISO datetime
  roomlistChangeSummary?: string | null;
  importChangeTypes?: ImportChangeType[];
  importChangeDetails?: ImportChangeDetail[];
  roomlistChangeAcknowledgedAt?: string | null;
  roomlistChangeAcknowledgedSummary?: string | null;

  missingFromLatestAthletesImport?: boolean;
  missingFromLatestRoomlistImport?: boolean;
  hasPendingRoomlistReview?: boolean;
  changeTouchesAssignment?: boolean;
  workflowStatus?: 'NEW_PERSON' | 'OPEN_ASSIGNMENT' | 'REVIEW_ASSIGNMENT' | 'CURRENT' | 'CONFLICT' | 'NO_ROOM';
  assignment?: {
    hasAssignment: boolean;
    hotelName?: string | null;
    hotelId?: string | null;
    roomNumber?: string | null;
    roomTypeName?: string | null;
    checkInDate?: string | null;
    checkOutDate?: string | null;
    bookingId?: string | null;
    countsAsSingle?: boolean;
  };
  assignments?: NonNullable<Athlete['assignment']>[];
}

/** Persisted athlete changes emitted by confirmation, used by assignment review. */
export type ImportChangeType =
  | 'NEW_ATHLETE'
  | 'DATE_CHANGED'
  | 'ROOMMATE_CHANGED'
  | 'ROOM_DEMAND_CHANGED'
  | 'EVENT_CHANGED'
  | 'NATION_CHANGED'
  | 'HOTEL_CHANGED';

export interface ImportChangeDetail {
  type: ImportChangeType;
  field: string;
  old?: string | null;
  new?: string | null;
}

export interface RoomAssignment {
  id: string;
  athlete: Athlete;
  hotel: { id: string; name: string };
  roomType: RoomType;
  roomNumber?: string | null;
  checkInDate?: string | null; // ISO date
  checkOutDate?: string | null; // ISO date
  sharedWith?: Athlete | null;
}

export interface RoomBookingOccupant {
  id: string;
  roomBookingId: string;
  athlete: Athlete;
  role?: string | null;
}

export interface RoomBooking {
  id: string;
  hotel: { id: string; name: string; accommodationType?: 'STANDARD' | 'EXTERNAL' };
  roomType: RoomType | null;
  roomNumber?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  countsAsSingle?: boolean;
  occupants: RoomBookingOccupant[];
}

export interface RoomBookingUnitOccupant extends AccommodationRateFields, AccommodationRequirementFields {
  accommodationCoverage?: AccommodationCoverage;
  athleteId: string;
  name: string;
  firstname: string;
  lastname: string;
  nationCode: string;
  discipline?: string | null;
  quotaDisciplines?: string[];
  approvedQuotaDisciplines?: string[];
  approvedQuotaContexts?: Array<{ nationCode: string; discipline: string; gender: string }>;
  gender?: string | null;
  function?: string | null;
  arrivalDate?: string | null;
  departureDate?: string | null;
  specialMeal?: string | null;
  roomType?: string | null;
  statusBadges: string[];
  single_room_status: SingleRoomStatus;
  singleRoomQuotaExemptReason?: SingleRoomQuotaExemptReason;
  single_room_decision_id?: string | null;
  hasPendingReview: boolean;
  importChangeTypes: ImportChangeType[];
  importChangeDetails: ImportChangeDetail[];
  changeTouchesAssignment: boolean;
  isAssigned?: boolean;
  assignedBookingId?: string | null;
  assignedHotelId?: string | null;
  assignedHotelName?: string | null;
  assignedRoomTypeId?: string | null;
  assignedRoomNumber?: string | null;
  countsAsSingle?: boolean;
}

export interface RoomBookingUnitWarning {
  code: string;
  level: 'warning' | 'error';
  message: string;
}

export interface RoomBookingUnit {
  unitId: string;
  sourceRowKey: string;
  nationCode: string;
  occupants: RoomBookingUnitOccupant[];
  roomType: string;
  roomTypeLabel: string;
  roomCategoryLabel?: string;
  occupantCount: number;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  specialMealFlags: string[];
  statusBadges: string[];
  assignmentWarnings: RoomBookingUnitWarning[];
  assignedBookingId?: string | null;
  assignedHotelId?: string | null;
  assignedHotelName?: string | null;
  assignedRoomTypeId?: string | null;
  assignedRoomNumber?: string | null;
  hasAnyAssigned?: boolean;
  isFullyAssigned?: boolean;
}

export interface AssignmentValidationResult {
  slotId: string;
  status: 'valid' | 'warning' | 'blocked';
  messages: string[];
}

export interface AssignmentGridBooking {
  bookingId: string;
  roomNumber?: string | null;
  hotelId: string;
  roomTypeId: string;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  countsAsSingle?: boolean;
  capacity?: number;
  occupants: Array<{
    athleteId: string;
    name: string;
    nationCode: string;
    firstname: string;
    lastname: string;
    discipline?: string | null;
    quotaDisciplines?: string[];
    approvedQuotaDisciplines?: string[];
    approvedQuotaContexts?: Array<{ nationCode: string; discipline: string; gender: string }>;
    gender?: string | null;
    function?: string | null;
    arrivalDate?: string | null;
    departureDate?: string | null;
    hasPendingReview: boolean;
    importChangeTypes: ImportChangeType[];
    importChangeDetails: ImportChangeDetail[];
    single_room_status: SingleRoomStatus;
    singleRoomQuotaExemptReason?: SingleRoomQuotaExemptReason;
    single_room_decision_id?: string | null;
  }>;
}

export interface AssignmentSlot {
  slotId: string;
  hotelId: string;
  hotelName: string;
  roomTypeId: string;
  roomTypeName: string;
  capacity: number;
  slotIndex: number;
  roomNumber?: string | null;
  inventoryRoomCount: number;
  dateCoverage: {
    availableFrom?: string | null;
    availableUntil?: string | null;
    coversRequestedRange: boolean;
  };
  bookings: AssignmentGridBooking[];
}

export interface AssignmentGridHotel {
  accommodationType?: 'STANDARD' | 'EXTERNAL';
  externalBookings?: RoomBooking[];
  hotelId: string;
  hotelName: string;
  location?: string | null;
  region?: string | null;
  comment?: string | null;
  inventoryComments?: Array<{id:string;roomTypeId:string;availableFrom:string;availableUntil:string;comment:string}>;
  slots: AssignmentSlot[];
}

export interface AssignmentPlanningView {
  timeline: {
    startDate?: string | null;
    endDate?: string | null;
  };
  units: {
    unassigned: RoomBookingUnit[];
    assigned: RoomBookingUnit[];
  };
  hotels: AssignmentGridHotel[];
  validationByUnit: Record<string, AssignmentValidationResult[]>;
}

export interface AssignmentValidationView {
  validationKey: string;
  validations: AssignmentValidationResult[];
}

export interface RoomAvailability {
  roomType: RoomType;
  available: number;
  demand: number;
  difference: number;
}



export interface HotelCapacityOverview {
  hotel: { id: string; name: string; location?: string; region?: string };
  roomTypes: {
    roomType: RoomType;
    inventoryRooms: number;
    inventoryBeds: number;
    occupiedBeds: number;
    occupiedRooms: number;
    remainingRooms: number;
    remainingBeds: number;
  }[];
  totals: {
    inventoryRooms: number;
    inventoryBeds: number;
    occupiedRooms: number;
    occupiedBeds: number;
    remainingRooms: number;
    remainingBeds: number;
  };
}

export interface HotelReservationRow {
  stayWindow?:StayWindow;
  assignmentId: string;
  roomNumber?: string | null;
  roomType: RoomType;
  occupancy: number;
  guestName: string;
  sharedWithName?: string | null;
  nationCode?: string;
  discipline?: string;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  specialNotes?: string | null;
}

export interface FisImportIssue {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type ImportControlKind = 'error'|'clarification'|'info';
export interface ImportControl {
  people:Array<{personKey:string;stayWindow?:StayWindow;competitions:Array<{id:string;name:string;group:string|null;gender:string|null}>;quotaContexts:Array<{nation:string;group:string;gender:string}>;internalNote?:string|null}>;
  issues:Array<{kind:ImportControlKind;code:string;message:string;personKeys:string[];source?:string|null;row?:number|null}>;
  competitions:Array<{id:string;name:string;group:string|null;gender:string|null;people:number;athletes:number;sportEntries?:Array<{nation:string;reported:number;regularMax:number;aboveRegular:number;championStarters:number;unverifiedAdditional:number;personKeys:string[];champions:Array<{personKey:string;source:string}>;sharedPoolReported:number|null;allocationConfirmed:false}>}>;
}

export interface FisImportPreviewPerson extends AccommodationRateFields, AccommodationRequirementFields {
  existingAthleteId?:number|null;
  arrivalDate?:string|null;departureDate?:string|null;
  singleRoomExemptionSource?:string|null;
  singleRoomAllocation?:{context?:[string,string,string]|null;status?:string}|null;
  worldChampionReferences?:Array<{id?:string;discipline?:string;championship?:string;championshipYear?:number;eventGroup?:string;source?:string}>;
  importAccommodationRequirement?: AccommodationRequirement | null;
  accommodationRequirementReviewRequired?: boolean;
  quotaDisciplines?: string[];
  athleteTopLevelDisciplines?: string[];
  athleteQuotaFamilies?:string[];
  topLevelDisciplines?: string[];
  rowNumber: number;
  function?: string | null;
  competitorId?: string | null;
  lastname: string;
  firstname: string;
  nationCode: string;
  discipline?: string | null;
  gender?: string | null;
  forGender?: string | null;
  operation: 'create' | 'update';
  roomType?: string | null;
  sharedWithName?: string | null;
  matchKey?: string;
  singleRoomEntitlement?: 'IN_QUOTA' | 'APPROVED_EXTRA' | 'APPROVAL_REQUIRED' | 'QUOTA_EXEMPT' | null;
  singleRoomQuotaExemptReason?: SingleRoomQuotaExemptReason;
}

export interface FisImportPreviewRoom {
  person1Key?: string;
  person2Key?: string | null;
  rowNumber: number;
  sourceRowKey: string;
  roomType: string;
  person1Name: string;
  person2Name?: string | null;
  sharedWithRawName?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  daySnapshot: Record<string, number>;
}

export interface ImportChangePlan {
  digest: string; eventId: number; nation: string; importVersion: number; snapshotScope: 'FULL_NATION';
  requiresDestructiveConfirmation: boolean;
  people: Record<'create'|'update'|'unchanged'|'remove', Array<{personId:number|null;personKey?:string;name:string;fisCode?:string;competitorId?:string;competitionIds?:number[];competitions?:Array<{id:number;name:string;importCode:string}>;bookingIds?:number[];approvalId?:number;approvalApplicability?:string;changes?:Array<{field:string;old:unknown;new:unknown}>;before?:Record<string,string|null>}>>;
  memberships: Record<'add'|'remove'|'unchanged',Array<{personId?:number;personKey?:string;competitionId:number}>>;
  operations: {legacy?:Array<{id:number;action:string}>;fis?:Array<{id:number;action:string;survivorId?:number}>;clearPartnerFields?:number[];bookingIds:number[];deleteEmptyBookingIds:number[];partnerIds:number[];partners?:Array<{id:number;name:string}>;bookings:Array<{id:number;check_in_date:string;check_out_date:string;counts_as_single:boolean}>};
}

export interface FisImportPreview {
  quotaOverview?: QuotaOverview;
  changePlan?: ImportChangePlan | null;
  planStale?: boolean;
  quotaRulesChanged?: boolean;
  roomListHasNoData?: boolean;
  previewToken: string;
  eventId?: string | null;
  isValid: boolean;
  detectedDiscipline?: string | null;
  singleRoomQuotaExemptOverrides?: Record<string, SingleRoomQuotaExemptReason>;
  summary: {
    people: {
      total: number;
      wouldCreate: number;
      wouldUpdate: number;
    };
    rooms: {
      total: number;
      wouldReplaceFisRooms: number;
      singles: number;
      shared: number;
    };
    validation: {
      errorCount: number;
      warningCount: number;
    };
  };
  entriesColumns: string[];
  roomColumns: string[];
  dayColumns: string[];
  people: FisImportPreviewPerson[];
  rooms: FisImportPreviewRoom[];
  errors: FisImportIssue[];
  warnings: FisImportIssue[];
  /** Fixed event admission limits and scoped exception coverage; article 8.2 eligibility is not inferred. */
  athleteQuotaChecks?: Array<{
    nationCode: string;
    topLevelDiscipline: string;
    athleteQuotaUsed: number;
    athleteQuotaLimit: number;
    athleteGenderUsed: { M: number; F: number };
    athleteGenderLimit: number;
    athleteQuotaExceeded: boolean;
    athleteGenderExceeded: { M: boolean; F: boolean };
    athleteGenderUnknown: number;
    athleteQuotaStatus: 'EXCEEDED' | 'INCOMPLETE' | 'WITHIN_BASE_LIMITS';
    worldChampionExceptionSupported: false;
    requiredExtent?:QuotaExtent;approvedExtent?:QuotaExtent;uncoveredExtent?:QuotaExtent;
    decisionStatus?:'PENDING'|'APPROVED'|'WITHIN_QUOTA';approvalIds?:number[];
  }>;
  quotaChecks?: Array<{ nationCode:string; discipline:string; gender:string; athletes:number; singleRoomsRequested:number; singleRoomsPending:number; singleRoomsApproved:number; officials:number; officialQuota:number; singleRooms:number; singleRoomsAllowed:number; quotaExemptSingleRooms?:number; officialsExceeded:boolean; singleRoomsExceeded:boolean }>;
  dispositionAnalysis: {
    categories: Record<DispositionImpactCategory, DispositionImpact>;
    changes: ImportChange[];
  };
}

/** Preview disposition changes; distinct from persisted athlete change details. */
export type PreviewImportChangeType =
  | 'NEW_PERSON' | 'PERSON_REMOVED' | 'STAY_CHANGED' | 'ROOMMATE_CHANGED'
  | 'ROOM_CREATED' | 'ROOM_REMOVED' | 'ROOM_CHANGED' | 'SINGLE_ROOM_CHANGED' | 'ROOMTYPE_CHANGED'
  | 'FUNCTION_CHANGED' | 'COUNTRY_CHANGED' | 'VALIDATION_ERROR';

export interface ImportChange {
  type: PreviewImportChangeType;
  preview: 'persons' | 'rooms';
  severity: 'info' | 'warning' | 'error';
  entityId: string;
  description: string;
  affectedPersonId?: string;
  affectedPersonIds?: string[];
}

export type DispositionImpactCategory =
  | 'newAthletes' | 'updatedAthletes' | 'removedAthletes'
  | 'dispositionAffected' | 'hotelAssignmentAffected' | 'roommateAffected'
  | 'stayChanged' | 'roomRequirementChanged' | 'quotaAffected'
  | 'approvalRequired' | 'additionalCostsPossible';

export interface DispositionImpact {
  count: number;
  records: Array<Record<string, unknown>>;
}

export interface FisMockFilePair {
  discipline: string;
  disciplineKey: string;
  entriesFile?: string | null;
  roomFile?: string | null;
  entriesDownloadUrl?: string | null;
  roomDownloadUrl?: string | null;
}

export interface FisImportConfirmResult {
  success: boolean;
  summary: {
    peopleCreated: number;
    peopleUpdated: number;
    peopleUnchanged?:number; peopleRemoved?:number; dispositionsChanged?:number; bookingsRemoved?:number; occupantsRemoved?:number; membershipsRemoved?:number;
    fisRoomsImported: number;
  };
  run: {
    id: string;
    importType: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
}

export interface WorldChampion {
  id: string; eventId: string; fisCode: string; name: string; nation: string;
  gender: string; discipline: string; eventGroup: string; championship: string;
  championshipYear: number; titleType: 'INDIVIDUAL' | 'TEAM'; entitlementEnabled: boolean;
  source: string; active: boolean; createdAt?: string; updatedAt?: string;
}

export interface AccommodationSplitPlan {
  booking:RoomBooking;
  athleteIds:string[];
  splitDate:string;
  previewToken:string;
  retainedSegments:Array<AccommodationInterval & {bookingId:string;athleteIds:string[]}>;
  people:Array<{personId:string;name:string;selected:boolean;affectedOpenIntervals:AccommodationInterval[];accommodationCoverage:AccommodationCoverage}>;
}
export type AccommodationSplitResult=Pick<AccommodationSplitPlan,'booking'|'athleteIds'|'splitDate'|'people'> & {success:boolean};

export interface ExternalStayPlan {
  replaceStandard?:boolean;
  previewToken:string;hotelId:string;hotelName:string;athleteIds:string[];
  checkInDate:string;checkOutDate:string;openInterval:AccommodationInterval;
  people:Array<{personId:string;name:string;accommodationCoverage:AccommodationCoverage}>;
}

export interface QuotaRevisionProposal {
  eventId: number; previousRevision: number; reason: string; confirmationDigest: string;
  before: {config: QuotaRuleConfig; isWorldChampionship: boolean};
  after: {config: QuotaRuleConfig; isWorldChampionship: boolean};
}
export interface QuotaRevisionSnapshot {
  eventId:string; revision:number; config:QuotaRuleConfig; isWorldChampionship:boolean;
  digest:string; activatedAt:string; activatedBy:string|null; reason:string;
}

/** Authoritative read-only preview aggregation; never a new quota allocation. */
export interface QuotaOverview {
  event: {id:string;name:string;isWorldChampionship:boolean;rulesRevision:number;rulesFixed:boolean};
  nations: Array<{
    nationCode:string;athletes:number;officials:number;peopleInQuotaGroups:number;peopleTotal:number;otherPeople:number;
    officialsInMultipleGroups:number;officialsWithoutContext:number;officialsWithoutCoverage:null;
    coverageReviewRequired:boolean;incomplete:boolean;athleteDecisionsOpen:number;ezDecisionsOpen:number;
    athletesApprovedDistinct:number|null;athleteApprovalFamilies:number;
    athleteFamilies:NonNullable<FisImportPreview['athleteQuotaChecks']>;
    groups:Array<{name:string;athletes:number;officials:number;coverageReviewRequired:boolean;
      contexts:NonNullable<FisImportPreview['quotaChecks']>;totals:{officialQuota:number;singleRoomsAllowed:number;singleRoomsRequested:number;singleRoomsPending:number;singleRoomsApproved:number;quotaExemptSingleRooms:number}}>
  }>;
}
