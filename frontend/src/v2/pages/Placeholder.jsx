import React from 'react';
import { PageHeading, Empty } from '../components/Primitives';
export default function Placeholder({title}) {return <div className="page"><PageHeading eyebrow="Vantage workspace" title={title}/><Empty title="Your evidence workspace">Live markets and finalized records will appear here once the V2 deployment is connected.</Empty></div>;}
