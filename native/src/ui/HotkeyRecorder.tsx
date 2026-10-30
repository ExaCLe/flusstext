import {useEffect, useRef, useState} from 'react'
import {View} from 'react-native'
import {MODIFIER_KEYS, normalizeKey, sortKeys} from '../../../src/shared/keys'
import {Button, Hotkey, T} from './components'
import {getApi, errorDetail, toast} from './store'
import {useTheme} from './theme'

export function HotkeyRecorder({value,onChange}:{value:number[];onChange:(keys:number[])=>void}) {
  const c=useTheme()
  const [recording,setRecording]=useState(false)
  const [combo,setCombo]=useState<number[]>([])
  const down=useRef(new Set<number>()), maximum=useRef<number[]>([])
  const change=useRef(onChange); change.current=onChange
  useEffect(()=>{
    if(!recording)return
    down.current.clear();maximum.current=[]
    const api=getApi()
    const off=api.subscribe(event=>{
      if(event.type!=='key')return
      const key=normalizeKey(event.keycode)
      if(event.down){
        if(key===1 && down.current.size===0){setRecording(false);return}
        down.current.add(key)
        if(down.current.size>=maximum.current.length)maximum.current=[...down.current]
        setCombo([...down.current])
      } else {
        down.current.delete(key)
        if(down.current.size===0 && maximum.current.length){
          const keys=sortKeys(maximum.current)
          if(keys.length>3)toast('Höchstens drei Tasten','error')
          else if(keys.length===1 && !MODIFIER_KEYS.has(keys[0]) && !([59,60,61,62,63,64,65,66,67,68,87,88].includes(keys[0])))toast('Bitte eine Tastenkombination wählen','error')
          else change.current(keys)
          setRecording(false)
        }
      }
    })
    void api.dictation.captureKeys(true).catch(error=>{setRecording(false);toast('Kurzbefehl konnte nicht aufgenommen werden','error',errorDetail(error))})
    return ()=>{off();void api.dictation.captureKeys(false).catch(()=>undefined)}
  },[recording])
  return <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
    {recording && !combo.length ? <T size={12} color={c.accentText}>Tasten drücken …</T> : <Hotkey keys={recording?combo:value}/>}
    <Button size="sm" onPress={()=>{setCombo([]);setRecording(!recording)}}>{recording?'Abbrechen':'Ändern'}</Button>
  </View>
}
