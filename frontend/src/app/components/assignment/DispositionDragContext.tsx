import { createContext } from 'react';
import type { AccommodationInterval, AssignmentValidationResult, AssignmentSlot } from '../../types';
import type {HotelFit} from '../../services/assignmentSuitability';
export const DispositionDragContext=createContext<{
  onAssignSlot?:(slot:AssignmentSlot)=>void;
  queueTargets?:Record<string,AssignmentValidationResult[]>;hotelId?:string;fits?:Record<string,HotelFit>;validations?:AssignmentValidationResult[];interval?:AccommodationInterval;occupantCount?:number;
}>({});
