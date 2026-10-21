import React,{createContext,useContext} from 'react';
import {usePrivy,useWallets} from '@privy-io/react-auth';
const unavailable={available:false,ready:true,authenticated:false,user:null,wallets:[],login:()=>{},logout:()=>{},getAccessToken:async()=>null};
const Context=createContext(unavailable);
export function AuthBridge({children}){const auth=usePrivy();const {wallets}=useWallets();return <Context.Provider value={{...auth,wallets,available:true}}>{children}</Context.Provider>;}
export function useAuth(){return useContext(Context);}
