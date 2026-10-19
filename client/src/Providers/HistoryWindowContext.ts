import { createContext } from 'react';

/** The shell supplies the preference/config policy to every message-cache observer. */
export const HistoryWindowContext = createContext<number | undefined>(undefined);
