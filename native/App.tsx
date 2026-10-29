import React from 'react'
import { FlusstextApp } from './src/ui/App'
import { createApi } from './src/core/api'
const api = createApi()
export default function App() { return <FlusstextApp api={api} /> }
