// import { useRouter } from 'next/router'
// import { useEffect, useState } from 'react'
// import { getEnv, putEnv } from '../../lib/api'

// export default function Editor(){
//   const router = useRouter()
//   const { key } = router.query
//   const [content, setContent] = useState('')
//   const [error, setError] = useState<string | null>(null)
//   const [saving, setSaving] = useState(false)
//   const [saveMessage, setSaveMessage] = useState<string | null>(null)
  
//   useEffect(()=>{ 
//     if(key) {
//       getEnv(String(key))
//         .then(setContent)
//         .catch(err => {
//           console.error('Failed to load env file:', err)
//           setError(err.message || 'Failed to connect to backend. Make sure the backend server is running on port 4000.')
//         })
//     }
//   },[key])
  
//   const handleSave = async () => {
//     if(!key) return
//     setSaving(true)
//     setError(null)
//     setSaveMessage(null)
//     try {
//       await putEnv(String(key), content)
//       setSaveMessage('Saved successfully!')
//       setTimeout(() => setSaveMessage(null), 3000)
//     } catch(err: any) {
//       console.error('Failed to save:', err)
//       setError(err.message || 'Failed to save file. Make sure the backend server is running on port 4000.')
//     } finally {
//       setSaving(false)
//     }
//   }
  
//   return (
//     <div className='p-6'>
//       <h2 className='text-xl mb-4'>Editor — {key}</h2>
//       {error && (
//         <div className='bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4'>
//           <p className='font-bold'>Error</p>
//           <p>{error}</p>
//         </div>
//       )}
//       {saveMessage && (
//         <div className='bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4'>
//           {saveMessage}
//         </div>
//       )}
//       <textarea 
//         value={content} 
//         onChange={e=>setContent(e.target.value)} 
//         className='w-full h-96 p-2 border'
//         disabled={!!error}
//       />
//       <button 
//         className='px-4 py-2 bg-blue-600 text-white mt-3 disabled:bg-gray-400 disabled:cursor-not-allowed' 
//         onClick={handleSave}
//         disabled={saving || !!error}
//       >
//         {saving ? 'Saving...' : 'Save'}
//       </button>
//     </div>
//   )
// }