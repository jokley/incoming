export type HotelContingentValues = {
  roomTypeId: string;
  roomCount: number | '';
  availableFrom: string;
  availableUntil: string;
  hasHalfBoard: boolean;
  hasSR: boolean;
  comment: string;
};

export type HotelContingentErrors = Partial<Record<keyof HotelContingentValues, string>>;

export const emptyContingentValues: HotelContingentValues = {
  roomTypeId: '', roomCount: '', availableFrom: '', availableUntil: '', hasHalfBoard: false, hasSR: false, comment: '',
};

export function validateHotelContingent(values: HotelContingentValues): HotelContingentErrors {
  const errors: HotelContingentErrors = {};
  if (!values.roomTypeId) errors.roomTypeId = 'Bitte einen Zimmertyp auswählen.';
  if (values.roomCount === '' || values.roomCount < 1) errors.roomCount = 'Mindestens ein Zimmer ist erforderlich.';
  if (!values.availableFrom) errors.availableFrom = 'Bitte ein Startdatum angeben.';
  if (!values.availableUntil) errors.availableUntil = 'Bitte ein Enddatum angeben.';
  if (values.availableFrom && values.availableUntil && values.availableUntil < values.availableFrom) errors.availableUntil = 'Das Enddatum muss nach dem Startdatum liegen.';
  return errors;
}
