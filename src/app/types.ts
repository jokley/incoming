export interface RoomType {
  id: string;
  name: string;
  maxPersons: number;
}

export interface AuthenticatedUser {
  username: string;
  displayName: string;
  email: string;
  groups: string[];
  permissions: string[];
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
}

export interface Hotel {
  id: string;
  name: string;
  location?: string;
  region?: string;
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

export interface Athlete {
  id: string;
  function?: string;
  competitorId?: string;
  accredId?: string;
  fisCode?: string;
  sourceRecordIds?: string[];
  disciplines?: string[];
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
  roomlistChangeAcknowledgedAt?: string | null;
  roomlistChangeAcknowledgedSummary?: string | null;

  missingFromLatestAthletesImport?: boolean;
  missingFromLatestRoomlistImport?: boolean;
  hasPendingRoomlistReview?: boolean;
  changeTouchesAssignment?: boolean;
  assignment?: {
    hasAssignment: boolean;
    hotelName?: string | null;
    hotelId?: string | null;
    roomNumber?: string | null;
    roomTypeName?: string | null;
    checkInDate?: string | null;
    checkOutDate?: string | null;
    bookingId?: string | null;
  };
  assignments?: NonNullable<Athlete['assignment']>[];
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
  hotel: { id: string; name: string };
  roomType: RoomType;
  roomNumber?: string | null;
  checkInDate?: string | null;
  checkOutDate?: string | null;
  countsAsSingle?: boolean;
  occupants: RoomBookingOccupant[];
}

export interface RoomBookingUnitOccupant {
  athleteId: string;
  name: string;
  firstname: string;
  lastname: string;
  nationCode: string;
  discipline?: string | null;
  gender?: string | null;
  function?: string | null;
  specialMeal?: string | null;
  roomType?: string | null;
  statusBadges: string[];
  hasPendingReview: boolean;
  changeTouchesAssignment: boolean;
  isAssigned?: boolean;
  assignedBookingId?: string | null;
  assignedHotelId?: string | null;
  assignedRoomTypeId?: string | null;
  assignedRoomNumber?: string | null;
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
  hotelId: string;
  hotelName: string;
  location?: string | null;
  region?: string | null;
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

export interface FisImportPreviewPerson {
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
}

export interface FisImportPreviewRoom {
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

export interface FisImportPreview {
  previewToken: string;
  isValid: boolean;
  detectedDiscipline?: string | null;
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
  quotaChecks?: Array<{ nationCode:string; discipline:string; gender:string; officials:number; officialQuota:number; singleRooms:number; singleRoomsAllowed:number; officialsExceeded:boolean; singleRoomsExceeded:boolean }>;
  dispositionAnalysis: {
    categories: Record<DispositionImpactCategory, DispositionImpact>;
  };
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
    fisRoomsImported: number;
  };
  run: {
    id: string;
    importType: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
}
