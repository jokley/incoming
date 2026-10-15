import { createContext } from 'react';
import type { AccommodationInterval, AssignmentValidationResult } from '../../types';
export const DispositionDragContext=createContext<{
  validations?:AssignmentValidationResult[];interval?:AccommodationInterval;occupantCount?:number;
}>({});
