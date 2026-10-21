import React from 'react';
import {ErrorNotice} from './Primitives';
export default function ActionFeedback({action}){return <><ErrorNotice error={action.error}/>{action.message&&<div role="status" className="notice">{action.message}</div>}</>;}
