import { useState, useEffect, useMemo, useRef } from 'react';
import { 
  collection, 
  query, 
  where, 
  or,
  onSnapshot, 
  addDoc, 
  updateDoc, 
  setDoc,
  getDoc,
  doc, 
  orderBy, 
  Timestamp,
  increment,
  getDocFromServer,
  getDocs,
  deleteDoc
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db, signIn, logout, storage, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from './firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { 
  Plus, 
  Pencil,
  Search, 
  ArrowUpRight, 
  ArrowDownLeft, 
  History, 
  User as UserIcon, 
  LogOut, 
  Sparkles, 
  Phone,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Store,
  ShoppingBag,
  Camera,
  Upload,
  X,
  Crop,
  Bell,
  CreditCard,
  MessageSquare,
  Send,
  Eye,
  EyeOff,
  CheckCircle,
  XCircle,
  Clock
} from 'lucide-react';
import { format } from 'date-fns';
import { bn } from 'date-fns/locale';
import { cn } from './lib/utils';
import { GoogleGenAI, Type } from "@google/genai";
import Cropper from 'react-easy-crop';
import getCroppedImg from './lib/cropImage';

// --- Types ---
interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  photoUrl?: string;
  totalBalance: number;
  ownerId: string;
  customerUid?: string;
  createdAt: Timestamp;
}

interface Transaction {
  id: string;
  customerId: string;
  amount: number;
  type: 'credit' | 'debit';
  note: string;
  ownerId: string;
  timestamp: Timestamp;
}

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- AI Service ---
let aiInstance: GoogleGenAI | null = null;

function getAi() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("GEMINI_API_KEY is missing!");
      return null;
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

async function parseTallyEntry(text: string) {
  const ai = getAi();
  if (!ai) throw new Error("AI service not initialized");
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Parse this Bengali tally entry: "${text}". 
    Extract: 
    1. Customer name (if mentioned)
    2. Amount (number)
    3. Type (either 'credit' if I gave money/goods or 'debit' if I received money)
    4. Note (brief description)
    
    Return JSON format.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          amount: { type: Type.NUMBER },
          type: { type: Type.STRING, enum: ["credit", "debit"] },
          note: { type: Type.STRING }
        },
        required: ["amount", "type"]
      }
    }
  });
  return JSON.parse(response.text);
}

// --- Components ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<'shopkeeper' | 'customer' | null>(null);
  const [customerProfile, setCustomerProfile] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddingCustomer, setIsAddingCustomer] = useState(false);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isDeletingCustomer, setIsDeletingCustomer] = useState(false);
  const [isAddingTransaction, setIsAddingTransaction] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [tempPhotoUrl, setTempPhotoUrl] = useState<string | null>(null);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);
  const [isCustomerLogin, setIsCustomerLogin] = useState(false);
  const [isCustomerRegister, setIsCustomerRegister] = useState(false);
  const [isShopkeeperLogin, setIsShopkeeperLogin] = useState(false);
  const [isShopkeeperRegister, setIsShopkeeperRegister] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [shopkeeperInfo, setShopkeeperInfo] = useState<{ email?: string; phone?: string; name?: string } | null>(null);
  const [shopkeeperProfile, setShopkeeperProfile] = useState<{ name?: string; email?: string; phone?: string; role?: string } | null>(null);
  const [isEditingShopkeeperProfile, setIsEditingShopkeeperProfile] = useState(false);
  const [paymentNotifications, setPaymentNotifications] = useState<any[]>([]);
  const [isViewingNotifications, setIsViewingNotifications] = useState(false);
  const [activeNotificationTab, setActiveNotificationTab] = useState<'payments' | 'messages'>('payments');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [inAppMessages, setInAppMessages] = useState<any[]>([]);
  const [isViewingMessages, setIsViewingMessages] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const conversations = useMemo(() => {
    if (!user) return [];
    const groups: { [key: string]: any[] } = {};
    inAppMessages.forEach(m => {
      const otherId = m.senderId === user.uid ? m.receiverId : m.senderId;
      if (!groups[otherId]) groups[otherId] = [];
      groups[otherId].push(m);
    });

    // For shopkeeper, include all linked customers who don't have messages yet
    if (userRole === 'shopkeeper') {
      customers.forEach(c => {
        if (c.customerUid && !groups[c.customerUid]) {
          groups[c.customerUid] = [];
        }
      });
    } else if (userRole === 'customer' && customerProfile?.ownerId) {
      // For customer, include the shopkeeper even if there are no messages yet
      if (!groups[customerProfile.ownerId]) {
        groups[customerProfile.ownerId] = [];
      }
    }

    return Object.entries(groups).map(([otherId, messages]) => {
      const customer = customers.find(c => c.customerUid === otherId);
      const name = customer ? customer.name : (userRole === 'customer' ? (shopkeeperInfo?.name || 'দোকানদার') : 'অজানা কাস্টমার');
      
      // Handle case with no messages
      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : { 
        message: 'কোন মেসেজ নেই', 
        timestamp: { toDate: () => new Date(), toMillis: () => 0 } 
      };
      
      const unreadCount = messages.filter(m => !m.isRead && m.receiverId === user.uid).length;
      return { otherId, name, lastMessage, unreadCount, messages };
    }).sort((a, b) => {
      const timeA = a.messages.length > 0 ? a.lastMessage.timestamp.toMillis() : 0;
      const timeB = b.messages.length > 0 ? b.lastMessage.timestamp.toMillis() : 0;
      if (timeA === 0 && timeB === 0) return a.name.localeCompare(b.name);
      return timeB - timeA;
    });
  }, [inAppMessages, user, customers, userRole, shopkeeperInfo]);

  const liveSelectedCustomer = useMemo(() => {
    if (!selectedCustomer) return null;
    return customers.find(c => c.id === selectedCustomer.id) || selectedCustomer;
  }, [customers, selectedCustomer]);

  // Auto-set active conversation for customers and shopkeepers
  useEffect(() => {
    if (isViewingMessages) {
      if (userRole === 'customer' && customerProfile?.ownerId) {
        setActiveConversationId(customerProfile.ownerId);
      } else if (userRole === 'shopkeeper' && liveSelectedCustomer?.customerUid) {
        setActiveConversationId(liveSelectedCustomer.customerUid);
      }
    }
  }, [isViewingMessages, userRole, customerProfile, liveSelectedCustomer]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [inAppMessages, activeConversationId, isViewingMessages]);

  // Mark messages as read when chat is opened
  useEffect(() => {
    if (isViewingMessages && activeConversationId && user) {
      const unreadMessages = inAppMessages.filter(m => 
        !m.isRead && m.senderId === activeConversationId && m.receiverId === user.uid
      );
      unreadMessages.forEach(m => handleMarkMessageAsRead(m.id));
    }
  }, [isViewingMessages, activeConversationId, inAppMessages, user]);

  // Mark payment notifications as read when notifications modal is opened
  useEffect(() => {
    if (isViewingNotifications && user && userRole === 'customer') {
      const unreadNotifications = paymentNotifications.filter(n => 
        !n.isRead && n.status !== 'pending'
      );
      unreadNotifications.forEach(n => handleMarkNotificationAsRead(n.id));
    }
  }, [isViewingNotifications, paymentNotifications, user, userRole]);

  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => setImageToCrop(reader.result as string));
    reader.readAsDataURL(file);
  };

  const onCropComplete = (_croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  const handleCropSave = async () => {
    if (!imageToCrop || !croppedAreaPixels || !user) return;
    setIsUploading(true);
    try {
      const croppedImage = await getCroppedImg(imageToCrop, croppedAreaPixels);
      if (croppedImage) {
        const storageRef = ref(storage, `customers/${user.uid}/${Date.now()}_profile.jpg`);
        const snapshot = await uploadBytes(storageRef, croppedImage);
        const url = await getDownloadURL(snapshot.ref);
        setTempPhotoUrl(url);
        setImageToCrop(null);
      }
    } catch (err: any) {
      console.error("Crop/Upload error:", err);
      setToast({ message: `ছবি আপলোড করা যায়নি: ${err.message}`, type: 'error' });
    } finally {
      setIsUploading(false);
    }
  };

  // Auth Listener
  useEffect(() => {
    console.log("Auth listener initialized");
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      console.log("Auth state changed:", u ? u.uid : "no user");
      try {
        if (u) {
          // Fetch role
          console.log("Fetching user role for:", u.uid);
          const userDoc = await getDoc(doc(db, 'users', u.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            let role = data.role;
            
            // If role is missing but it's the admin email, set it to shopkeeper
            if (!role && u.email === 'munnahossain883@gmail.com') {
              role = 'shopkeeper';
              await updateDoc(doc(db, 'users', u.uid), { role: 'shopkeeper' });
            }
            
            console.log("User role found:", role);
            setUserRole(role);
            if (role === 'shopkeeper') {
              setShopkeeperProfile({ ...data, role });
            }
          } else {
            console.log("User doc does not exist");
            // Default to shopkeeper for Google login if not found
            if (u.providerData.some(p => p.providerId === 'google.com')) {
              console.log("Google user, setting default role as shopkeeper");
              const newShopkeeper = { 
                role: 'shopkeeper', 
                uid: u.uid,
                email: u.email || '',
                name: u.displayName || ''
              };
              await setDoc(doc(db, 'users', u.uid), newShopkeeper);
              setUserRole('shopkeeper');
              setShopkeeperProfile(newShopkeeper);
            }
          }
        } else {
          setUserRole(null);
          setCustomerProfile(null);
        }
      } catch (err) {
        console.error("Error in auth listener:", err);
      } finally {
        setUser(u);
        setLoading(false);
        console.log("Loading set to false");
      }
    });
    return unsubscribe;
  }, []);

  // Customer Profile Listener (for customer role)
  useEffect(() => {
    if (!user || userRole !== 'customer') {
      setCustomerProfile(null);
      return;
    }

    const path = 'customers';
    const q = query(collection(db, path), where('customerUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setCustomerProfile({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Customer);
        console.log("Customer profile updated in real-time");
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return unsubscribe;
  }, [user, userRole]);

  // Fetch Shopkeeper Info for Customer
  useEffect(() => {
    if (userRole === 'customer' && customerProfile?.ownerId) {
      console.log("Fetching shopkeeper info for ownerId:", customerProfile.ownerId);
      const fetchShopkeeper = async () => {
        try {
          const docRef = doc(db, 'users', customerProfile.ownerId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            console.log("Shopkeeper info found:", docSnap.data());
            setShopkeeperInfo(docSnap.data());
          } else {
            console.log("Shopkeeper doc does not exist for ownerId:", customerProfile.ownerId);
          }
        } catch (err) {
          console.error("Error fetching shopkeeper info:", err);
        }
      };
      fetchShopkeeper();
    } else {
      setShopkeeperInfo(null);
    }
  }, [userRole, customerProfile?.ownerId]);

  // Firestore Connection Test
  useEffect(() => {
    if (user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Firebase configuration error.");
          }
        }
      };
      testConnection();
    }
  }, [user]);

  // Fetch Customers
  useEffect(() => {
    if (!user || userRole !== 'shopkeeper') return;
    const path = 'customers';
    const q = query(collection(db, path), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Customer));
      setCustomers(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return unsubscribe;
  }, [user, userRole]);

  // Fetch Payment Notifications
  useEffect(() => {
    if (!user) {
      setPaymentNotifications([]);
      return;
    }
    const path = 'payment_notifications';
    let q;
    if (userRole === 'shopkeeper') {
      q = query(collection(db, path), where('ownerId', '==', user.uid), orderBy('timestamp', 'desc'));
    } else if (userRole === 'customer') {
      // Query by both UID (old) and customerProfile.id (new) if available
      const targetId = customerProfile?.id || user.uid;
      q = query(collection(db, path), where('customerId', '==', targetId), orderBy('timestamp', 'desc'));
    } else {
      setPaymentNotifications([]);
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setPaymentNotifications(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return unsubscribe;
  }, [user, userRole, customerProfile]);

  // Fetch In-App Messages
  useEffect(() => {
    if (!user) {
      setInAppMessages([]);
      return;
    }
    const path = 'in_app_messages';
    // Fetch messages where user is sender OR receiver
    const q = query(
      collection(db, path),
      or(
        where('receiverId', '==', user.uid),
        where('senderId', '==', user.uid)
      ),
      orderBy('timestamp', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setInAppMessages(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return unsubscribe;
  }, [user]);

  // Fetch Transactions for selected customer or current customer
  useEffect(() => {
    if (!user) {
      setTransactions([]);
      return;
    }
    
    const targetCustomerId = userRole === 'customer' ? customerProfile?.id : selectedCustomer?.id;
    if (!targetCustomerId) {
      setTransactions([]);
      return;
    }

    const path = 'transactions';
    const q = query(
      collection(db, path), 
      where('customerId', '==', targetCustomerId),
      orderBy('timestamp', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Transaction));
      setTransactions(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return unsubscribe;
  }, [user, userRole, selectedCustomer, customerProfile]);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      c.phone.includes(searchQuery)
    );
  }, [customers, searchQuery]);

  const totalPaben = customers.reduce((acc, c) => (c.totalBalance || 0) > 0 ? acc + (c.totalBalance || 0) : acc, 0);
  const totalDeben = customers.reduce((acc, c) => (c.totalBalance || 0) < 0 ? acc + Math.abs(c.totalBalance || 0) : acc, 0);

  const customerStats = useMemo(() => {
    const targetId = userRole === 'customer' ? customerProfile?.id : liveSelectedCustomer?.id;
    if (!targetId || !transactions.length) return { deposit: 0, expense: 0 };
    return transactions.reduce((acc, tx) => {
      if (tx.type === 'debit') acc.deposit += tx.amount;
      else acc.expense += tx.amount;
      return acc;
    }, { deposit: 0, expense: 0 });
  }, [userRole, transactions, customerProfile, liveSelectedCustomer]);

  const handleAddCustomer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    let phone = (formData.get('phone') as string).replace(/\D/g, '');
    if (phone.startsWith('880')) phone = phone.substring(2);
    else if (phone.startsWith('88')) phone = phone.substring(2);
    
    const address = formData.get('address') as string;
    const photoUrl = tempPhotoUrl || (formData.get('photoUrl') as string);

    const path = 'customers';
    try {
      await addDoc(collection(db, path), {
        name,
        phone,
        address: address || '',
        photoUrl: photoUrl || '',
        totalBalance: 0,
        ownerId: user.uid,
        createdAt: Timestamp.now()
      });
      setIsAddingCustomer(false);
      setTempPhotoUrl(null);
      setToast({ message: 'কাস্টমার সফলভাবে যোগ করা হয়েছে', type: 'success' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleEditCustomer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !selectedCustomer) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    let phone = (formData.get('phone') as string).replace(/\D/g, '');
    if (phone.startsWith('880')) phone = phone.substring(2);
    else if (phone.startsWith('88')) phone = phone.substring(2);
    
    const address = formData.get('address') as string;
    const photoUrl = tempPhotoUrl || (formData.get('photoUrl') as string);

    const path = `customers/${selectedCustomer.id}`;
    try {
      await updateDoc(doc(db, 'customers', selectedCustomer.id), {
        name,
        phone,
        address: address || '',
        photoUrl: photoUrl || '',
      });
      // Update local state for selected customer
      setSelectedCustomer({
        ...selectedCustomer,
        name,
        phone,
        address,
        photoUrl
      });
      setIsEditingCustomer(false);
      setTempPhotoUrl(null);
      setToast({ message: 'কাস্টমার তথ্য সফলভাবে আপডেট করা হয়েছে', type: 'success' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleEditProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !customerProfile) return;

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const address = formData.get('address') as string;
    const photoUrl = tempPhotoUrl || (formData.get('photoUrl') as string);

    const path = `customers/${customerProfile.id}`;
    try {
      await updateDoc(doc(db, 'customers', customerProfile.id), {
        name,
        address: address || '',
        photoUrl: photoUrl || '',
      });
      setIsEditingProfile(false);
      setTempPhotoUrl(null);
      setToast({ message: 'আপনার প্রোফাইল সফলভাবে আপডেট করা হয়েছে', type: 'success' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleEditShopkeeperProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const phone = formData.get('phone') as string;
    const email = formData.get('email') as string;

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        name,
        phone,
        email
      });
      setShopkeeperProfile(prev => prev ? { ...prev, name, phone, email } : { name, phone, email });
      setToast({ message: 'দোকানদার প্রোফাইল আপডেট হয়েছে', type: 'success' });
      setIsEditingShopkeeperProfile(false);
    } catch (err: any) {
      setToast({ message: `আপডেট ব্যর্থ হয়েছে: ${err.message}`, type: 'error' });
    }
  };

  const handleSubmitPayment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || userRole !== 'customer' || !customerProfile) return;
    
    const formData = new FormData(e.currentTarget);
    const amount = Number(formData.get('amount'));
    const method = formData.get('method') as string;
    const senderPhone = formData.get('senderPhone') as string;
    const transactionId = formData.get('transactionId') as string;

    if (!amount || !method || !senderPhone || !transactionId) {
      setToast({ message: 'সবগুলো ঘর পূরণ করুন', type: 'error' });
      return;
    }

    const path = 'payment_notifications';
    try {
      await addDoc(collection(db, path), {
        customerId: customerProfile.id, // Use document ID instead of user.uid
        customerName: customerProfile.name,
        amount,
        method,
        senderPhone,
        transactionId,
        status: 'pending',
        isRead: false,
        ownerId: customerProfile.ownerId,
        timestamp: Timestamp.now()
      });
      setToast({ message: 'পেমেন্ট তথ্য সফলভাবে পাঠানো হয়েছে। দোকানদার যাচাই করে আপডেট করবেন।', type: 'success' });
      setIsSubmittingPayment(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleUpdateNotificationStatus = async (notification: any, status: 'approved' | 'rejected') => {
    if (!user || userRole !== 'shopkeeper') return;
    const id = notification.id;
    const path = `payment_notifications/${id}`;
    try {
      await updateDoc(doc(db, 'payment_notifications', id), { 
        status,
        isRead: false // Reset isRead so customer sees the update
      });
      
      if (status === 'approved') {
        let customerDocId = notification.customerId;
        
        // Verify if customerId is a document ID or a UID
        const customerDocRef = doc(db, 'customers', customerDocId);
        const customerDocSnap = await getDoc(customerDocRef);
        
        if (!customerDocSnap.exists()) {
          // If not found by ID, it might be a UID. Search for the customer document by customerUid
          const q = query(collection(db, 'customers'), where('customerUid', '==', customerDocId), where('ownerId', '==', user.uid));
          const querySnap = await getDocs(q);
          if (!querySnap.empty) {
            customerDocId = querySnap.docs[0].id;
          } else {
            throw new Error('কাস্টমার রেকর্ড খুঁজে পাওয়া যায়নি।');
          }
        }

        // Automatically add a transaction and update customer balance
        const txPath = 'transactions';
        await addDoc(collection(db, txPath), {
          customerId: customerDocId,
          amount: notification.amount,
          type: 'debit', // Payment is a debit (customer paying off debt)
          note: `পেমেন্ট অনুমোদন (${notification.method}) - ট্রানজেকশন আইডি: ${notification.transactionId}`,
          ownerId: user.uid,
          timestamp: Timestamp.now()
        });

        // Update customer balance
        await updateDoc(doc(db, 'customers', customerDocId), {
          totalBalance: increment(-notification.amount)
        });
      }

      setToast({ message: `পেমেন্ট ${status === 'approved' ? 'অনুমোদন' : 'প্রত্যাখ্যান'} করা হয়েছে`, type: 'success' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleSendSMS = async (customer: any) => {
    if (!customer.phone) return;
    
    const balance = Math.abs(customer.totalBalance);
    const message = `আপনার ${balance} টাকা বকেয়া রয়েছে। আপনার হিসাব মিলিয়ে দেখন এবং অতিসিগ্রই তা পরিশোধ করার জন্য অনুরোধ জানাচ্ছি।

অনুরোধক্রমে, 
রাজগঞ্জ সুপার শপ 
প্রোঃ মুন্না হোসেন
মোবাঃ ০১৭৩৬৬৫৯০৫৮
ঠিকানাঃ রাজগঞ্জ শ্মশান মোড়, মনিরামপুর, যশোর।`;

    // Send real SMS
    const encodedMessage = encodeURIComponent(message);
    window.location.href = `sms:${customer.phone}?body=${encodedMessage}`;

    // Also send in-app message if customer is registered
    if (customer.customerUid && user) {
      const path = 'in_app_messages';
      try {
        await addDoc(collection(db, path), {
          senderId: user.uid,
          receiverId: customer.customerUid,
          message,
          isRead: false,
          timestamp: Timestamp.now()
        });
      } catch (err) {
        console.error('Error sending in-app message:', err);
      }
    }
  };

  const handleReplyMessage = async (receiverId: string, message: string) => {
    if (!user || !message.trim()) return;
    const path = 'in_app_messages';
    try {
      await addDoc(collection(db, path), {
        senderId: user.uid,
        receiverId,
        message,
        isRead: false,
        timestamp: Timestamp.now()
      });
      setToast({ message: 'আপনার উত্তর পাঠানো হয়েছে', type: 'success' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleMarkNotificationAsRead = async (id: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'payment_notifications', id), { isRead: true });
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  };

  const handleMarkMessageAsRead = async (messageId: string) => {
    try {
      await updateDoc(doc(db, 'in_app_messages', messageId), { isRead: true });
    } catch (err) {
      console.error('Error marking message as read:', err);
    }
  };

  const handleDeleteCustomer = async () => {
    if (!user || !selectedCustomer) return;
    
    const customerPath = `customers/${selectedCustomer.id}`;
    try {
      // 1. Delete all transactions for this customer
      const q = query(collection(db, 'transactions'), where('customerId', '==', selectedCustomer.id));
      const querySnapshot = await getDocs(q);
      
      const deletePromises = querySnapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
      
      // 2. Delete the customer document
      await deleteDoc(doc(db, 'customers', selectedCustomer.id));
      
      // 3. Reset state
      setSelectedCustomer(null);
      setIsDeletingCustomer(false);
      setIsEditingCustomer(false);
      setToast({ message: 'কাস্টমার সফলভাবে মুছে ফেলা হয়েছে', type: 'success' });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, customerPath);
    }
  };

  const handleAddTransaction = async (amount: number, type: 'credit' | 'debit', note: string, customerId?: string) => {
    if (!user) return;
    const targetId = customerId || selectedCustomer?.id;
    if (!targetId) return;

    const txPath = 'transactions';
    const custPath = `customers/${targetId}`;
    try {
      await addDoc(collection(db, txPath), {
        customerId: targetId,
        amount,
        type,
        note,
        ownerId: user.uid,
        timestamp: Timestamp.now()
      });

      // Update customer balance
      const balanceChange = type === 'credit' ? amount : -amount;
      await updateDoc(doc(db, 'customers', targetId), {
        totalBalance: increment(balanceChange)
      });
      
      console.log("Transaction added and balance updated for:", targetId);
      setIsAddingTransaction(false);
      setToast({ message: 'লেনদেন সফলভাবে যোগ করা হয়েছে', type: 'success' });
    } catch (err) {
      console.error("Error adding transaction:", err);
      handleFirestoreError(err, OperationType.WRITE, txPath);
    }
  };

  const handleAiEntry = async () => {
    if (!aiInput.trim()) return;
    setIsAiProcessing(true);
    try {
      const result = await parseTallyEntry(aiInput);
      let targetCustomer = selectedCustomer;
      
      if (result.name && !selectedCustomer) {
        targetCustomer = customers.find(c => c.name.toLowerCase().includes(result.name.toLowerCase())) || null;
      }

      if (targetCustomer) {
        await handleAddTransaction(result.amount, result.type, result.note || 'AI Entry', targetCustomer.id);
        setAiInput('');
        setToast({ message: 'লেনদেন সফলভাবে যোগ করা হয়েছে', type: 'success' });
      } else {
        setToast({ message: 'কাস্টমার খুঁজে পাওয়া যায়নি। অনুগ্রহ করে কাস্টমার সিলেক্ট করুন।', type: 'error' });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsAiProcessing(false);
    }
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleCustomerAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthLoading(true);
    const formData = new FormData(e.currentTarget);
    // Normalize phone: remove all non-digits and handle leading 88 if present
    let phone = (formData.get('phone') as string).replace(/\D/g, '');
    if (phone.startsWith('880')) phone = phone.substring(2);
    else if (phone.startsWith('88')) phone = phone.substring(2);
    
    const password = formData.get('password') as string;
    const email = formData.get('email') as string;
    const name = formData.get('name') as string;

    if (!phone || phone.length < 10) {
      setToast({ message: 'সঠিক ১১ ডিজিটের ফোন নাম্বার দিন', type: 'error' });
      setAuthLoading(false);
      return;
    }

    try {
      if (isCustomerRegister) {
        // 1. Create Auth User first (using virtual email based on phone)
        const authEmail = `${phone}@tallyapp.com`;
        const userCredential = await createUserWithEmailAndPassword(auth, authEmail, password);
        const uid = userCredential.user.uid;

        // 2. Now authenticated, check if customer exists in shopkeeper's list by phone
        // The rules now allow authenticated users to read unlinked customer records
        const q = query(collection(db, 'customers'), where('phone', '==', phone));
        const snap = await getDocs(q);
        
        if (snap.empty) {
          // If not in list, delete the newly created auth user and show error
          await userCredential.user.delete();
          setToast({ message: 'আপনার ফোন নাম্বারটি দোকানদারের লিস্টে নেই। অনুগ্রহ করে দোকানদারের সাথে যোগাযোগ করুন।', type: 'error' });
          setAuthLoading(false);
          return;
        }

        const customerDoc = snap.docs[0];
        if (customerDoc.data().customerUid) {
          // If already linked, this shouldn't happen if we check before creating, but for safety:
          await userCredential.user.delete();
          setToast({ message: 'এই নাম্বার দিয়ে ইতিমধ্যে একাউন্ট করা হয়েছে। লগইন করুন।', type: 'error' });
          setAuthLoading(false);
          return;
        }

        // 3. Create User Doc
        await setDoc(doc(db, 'users', uid), { 
          role: 'customer', 
          uid, 
          phone, 
          realEmail: email, 
          name 
        });

        // 4. Link Customer Doc
        await updateDoc(doc(db, 'customers', customerDoc.id), { customerUid: uid });
        
        setToast({ message: 'একাউন্ট সফলভাবে তৈরি হয়েছে', type: 'success' });
      } else {
        // Login using phone-based virtual email
        const authEmail = `${phone}@tallyapp.com`;
        await signInWithEmailAndPassword(auth, authEmail, password);
        setToast({ message: 'লগইন সফল হয়েছে', type: 'success' });
      }
    } catch (err: any) {
      console.error("Auth Error:", err);
      let errorMessage = 'কিছু ভুল হয়েছে। আবার চেষ্টা করুন।';
      
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        errorMessage = 'ফোন নাম্বার অথবা পাসওয়ার্ড ভুল। অনুগ্রহ করে সঠিক তথ্য দিন।';
      } else if (err.code === 'auth/email-already-in-use') {
        errorMessage = 'এই নাম্বার দিয়ে ইতিমধ্যে একাউন্ট করা হয়েছে।';
      } else if (err.code === 'auth/weak-password') {
        errorMessage = 'পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে।';
      } else if (err.code === 'auth/too-many-requests') {
        errorMessage = 'অতিরিক্ত চেষ্টার কারণে আপনার একাউন্ট সাময়িকভাবে বন্ধ করা হয়েছে। পরে আবার চেষ্টা করুন।';
      } else if (err.message) {
        errorMessage = `ভুল হয়েছে: ${err.message}`;
      }
      
      setToast({ message: errorMessage, type: 'error' });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthLoading(true);
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;

    if (!email) {
      setToast({ message: 'অনুগ্রহ করে আপনার ইমেইল এড্রেস দিন।', type: 'error' });
      setAuthLoading(false);
      return;
    }

    try {
      await sendPasswordResetEmail(auth, email);
      setToast({ message: 'পাসওয়ার্ড রিসেট করার লিংক আপনার ইমেইলে পাঠানো হয়েছে। অনুগ্রহ করে ইমেইল চেক করুন।', type: 'success' });
      setIsForgotPassword(false);
      setIsShopkeeperLogin(true);
    } catch (err: any) {
      console.error("Password Reset Error:", err);
      let errorMessage = 'পাসওয়ার্ড রিসেট লিংক পাঠানো যায়নি। আবার চেষ্টা করুন।';
      if (err.code === 'auth/user-not-found') {
        errorMessage = 'এই ইমেইল দিয়ে কোন একাউন্ট পাওয়া যায়নি।';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage = 'অনুগ্রহ করে একটি সঠিক ইমেইল এড্রেস দিন।';
      }
      setToast({ message: errorMessage, type: 'error' });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleShopkeeperAuth = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthLoading(true);
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    let phone = (formData.get('phone') as string)?.replace(/\D/g, '');
    if (phone && phone.startsWith('880')) phone = phone.substring(2);
    else if (phone && phone.startsWith('88')) phone = phone.substring(2);
    
    const name = formData.get('name') as string;
    const shopName = formData.get('shopName') as string;
    const loginIdentifier = formData.get('loginIdentifier') as string;

    try {
      if (isShopkeeperRegister) {
        // Registration
        if (!email || !password || !phone || !name || !shopName) {
          setToast({ message: 'সবগুলো তথ্য সঠিকভাবে দিন', type: 'error' });
          setAuthLoading(false);
          return;
        }

        // Check if phone already exists for a shopkeeper
        const qPhone = query(collection(db, 'users'), where('phone', '==', phone), where('role', '==', 'shopkeeper'));
        const snapPhone = await getDocs(qPhone);
        if (!snapPhone.empty) {
          setToast({ message: 'এই ফোন নাম্বার দিয়ে ইতিমধ্যে একাউন্ট করা হয়েছে।', type: 'error' });
          setAuthLoading(false);
          return;
        }

        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;

        await setDoc(doc(db, 'users', uid), {
          role: 'shopkeeper',
          uid,
          email,
          phone,
          name,
          shopName,
          createdAt: Timestamp.now()
        });

        // Sign out after registration so they have to log in manually as requested
        await logout();
        
        setToast({ message: 'দোকানদার একাউন্ট সফলভাবে তৈরি হয়েছে। এখন লগইন করুন।', type: 'success' });
        setIsShopkeeperRegister(false);
        setIsShopkeeperLogin(true);
      } else {
        // Login
        let authEmail = loginIdentifier.trim();
        
        // Normalize login identifier if it's a phone number
        // Strip non-digits to check if it's a phone number
        const digitsOnly = authEmail.replace(/\D/g, '');
        if (digitsOnly.length >= 10 && (authEmail.startsWith('+') || authEmail.match(/^\d+$/) || authEmail.startsWith('88'))) {
          let normalizedPhone = digitsOnly;
          if (normalizedPhone.startsWith('880')) normalizedPhone = normalizedPhone.substring(2);
          else if (normalizedPhone.startsWith('88')) normalizedPhone = normalizedPhone.substring(2);
          
          const q = query(collection(db, 'users'), where('phone', '==', normalizedPhone), where('role', '==', 'shopkeeper'));
          const snap = await getDocs(q);
          if (snap.empty) {
            setToast({ message: 'এই ফোন নাম্বার দিয়ে কোন দোকানদার একাউন্ট পাওয়া যায়নি।', type: 'error' });
            setAuthLoading(false);
            return;
          }
          authEmail = snap.docs[0].data().email;
        }

        await signInWithEmailAndPassword(auth, authEmail, password);
        setToast({ message: 'লগইন সফল হয়েছে', type: 'success' });
      }
    } catch (err: any) {
      console.error("Shopkeeper Auth Error:", err);
      let errorMessage = 'কিছু ভুল হয়েছে। আবার চেষ্টা করুন।';
      
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
        errorMessage = 'ইমেইল/ফোন অথবা পাসওয়ার্ড ভুল। অনুগ্রহ করে সঠিক তথ্য দিন।';
      } else if (err.code === 'auth/email-already-in-use') {
        errorMessage = 'এই ইমেইল এড্রেসটি ইতিমধ্যে অন্য একটি একাউন্টে ব্যবহার করা হয়েছে। আপনি কি লগইন করতে চান?';
        setToast({ message: errorMessage, type: 'error' });
        // Automatically switch to login if they are on register
        if (isShopkeeperRegister) {
          setTimeout(() => {
            setIsShopkeeperRegister(false);
            setIsShopkeeperLogin(true);
          }, 2000);
        }
        return;
      } else if (err.code === 'auth/invalid-email') {
        errorMessage = 'অনুগ্রহ করে একটি সঠিক ইমেইল এড্রেস দিন।';
      } else if (err.code === 'auth/weak-password') {
        errorMessage = 'পাসওয়ার্ড অন্তত ৬ অক্ষরের হতে হবে।';
      }
      
      setToast({ message: errorMessage, type: 'error' });
    } finally {
      setAuthLoading(false);
    }
  };

  const handleShopkeeperLogin = async () => {
    setIsShopkeeperLogin(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5f5f0] gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#5A5A40]" />
        <p className="text-[#5A5A40] font-serif italic animate-pulse">অ্যাপটি লোড হচ্ছে, অনুগ্রহ করে অপেক্ষা করুন...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] flex flex-col items-center justify-center p-6">
        {toast && (
          <div className={cn(
            "fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-lg flex items-center gap-3 animate-in fade-in slide-in-from-top-4",
            toast.type === 'success' ? "bg-green-600 text-white" : "bg-red-600 text-white"
          )}>
            {toast.type === 'success' ? <Sparkles className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span className="font-bold">{toast.message}</span>
            <button onClick={() => setToast(null)} className="ml-2 hover:opacity-70">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="max-w-md w-full bg-white rounded-[32px] p-10 shadow-sm border border-[#e5e5e0]">
          <div className="flex items-center justify-center gap-4 mb-8">
            <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-md overflow-hidden border border-[#e5e5e0] shrink-0">
              <img 
                src="https://ais-pre-jxad4a5s7krwbvf6rsouki-769162757935.asia-southeast1.run.app/api/attachments/40f69d2c-8094-4752-9599-5285741f2231" 
                className="w-full h-full object-contain p-1" 
                alt="রাজগঞ্জ সুপার শপ লোগো" 
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.src = 'https://cdn-icons-png.flaticon.com/512/3081/3081840.png';
                }}
              />
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-serif font-bold text-[#1a1a1a]">রাজগঞ্জ সুপার শপ</h1>
              <p className="text-[#5A5A40] text-sm font-serif italic">ডিজিটাল হিসাব ও কাস্টমার ম্যানেজমেন্ট</p>
            </div>
          </div>
          
          {isCustomerLogin || isCustomerRegister ? (
            <form onSubmit={handleCustomerAuth} className="space-y-4 text-left">
              {isCustomerRegister && (
                <div>
                  <label className="block text-xs font-bold text-[#5A5A40] uppercase tracking-wider mb-1">আপনার নাম</label>
                  <input 
                    name="name" 
                    type="text" 
                    required 
                    className="w-full bg-[#f5f5f0] border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                    placeholder="পুরো নাম লিখুন"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase tracking-wider mb-1">ফোন নাম্বার</label>
                <input 
                  name="phone" 
                  type="tel" 
                  required 
                  className="w-full bg-[#f5f5f0] border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                  placeholder="017XXXXXXXX"
                />
              </div>
              {isCustomerRegister && (
                <div>
                  <label className="block text-xs font-bold text-[#5A5A40] uppercase tracking-wider mb-1">ইমেইল এড্রেস</label>
                  <input 
                    name="email" 
                    type="email" 
                    required 
                    className="w-full bg-[#f5f5f0] border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                    placeholder="example@mail.com"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase tracking-wider mb-1">পাসওয়ার্ড</label>
                <div className="relative">
                  <input 
                    name="password" 
                    type={showPassword ? "text" : "password"} 
                    required 
                    minLength={6}
                    className="w-full bg-[#f5f5f0] border-none rounded-2xl px-4 py-3 pr-12 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                    placeholder="******"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#5A5A40] hover:text-[#1a1a1a] transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <button 
                disabled={authLoading}
                className="w-full bg-[#5A5A40] text-white py-4 rounded-full font-bold hover:bg-[#4a4a35] transition-colors disabled:opacity-50"
              >
                {authLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (isCustomerRegister ? 'রেজিস্ট্রেশন করুন' : 'লগইন করুন')}
              </button>
              <button 
                type="button"
                onClick={() => setIsCustomerRegister(!isCustomerRegister)}
                className="w-full text-sm text-[#5A5A40] font-bold hover:underline"
              >
                {isCustomerRegister ? 'ইতিমধ্যে একাউন্ট আছে? লগইন করুন' : 'নতুন একাউন্ট তৈরি করুন'}
              </button>
              <button 
                type="button"
                onClick={() => { setIsCustomerLogin(false); setIsCustomerRegister(false); }}
                className="w-full text-sm text-gray-400 hover:underline"
              >
                পিছনে যান
              </button>
            </form>
          ) : isForgotPassword ? (
            <form onSubmit={handleForgotPassword} className="space-y-4 text-left">
              <h2 className="text-lg font-bold text-[#1a1a1a] mb-2">পাসওয়ার্ড রিসেট করুন</h2>
              <p className="text-sm text-gray-500 mb-4">আপনার একাউন্টের ইমেইল এড্রেসটি দিন। আমরা আপনাকে পাসওয়ার্ড রিসেট করার একটি লিংক পাঠাবো।</p>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase tracking-wider mb-1">ইমেইল এড্রেস</label>
                <input 
                  name="email" 
                  type="email" 
                  required 
                  className="w-full bg-[#f5f5f0] border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                  placeholder="example@mail.com"
                />
              </div>
              <button 
                disabled={authLoading}
                className="w-full bg-[#5A5A40] text-white py-4 rounded-full font-bold hover:bg-[#4a4a35] transition-colors disabled:opacity-50"
              >
                {authLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'রিসেট লিংক পাঠান'}
              </button>
              <button 
                type="button"
                onClick={() => { setIsForgotPassword(false); setIsShopkeeperLogin(true); }}
                className="w-full text-sm text-[#5A5A40] font-bold hover:underline"
              >
                লগইন ফর্মে ফিরে যান
              </button>
            </form>
          ) : isShopkeeperLogin || isShopkeeperRegister ? (
            <form onSubmit={handleShopkeeperAuth} className="space-y-4 text-left">
              {isShopkeeperRegister ? (
                <>
                  <div>
                    <label className="block text-xs font-bold text-[#5A5A40] uppercase tracking-wider mb-1">দোকানের নাম</label>
                    <input 
                      name="shopName" 
                      type="text" 
                      required 
                      className="w-full bg-[#f5f5f0] border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                      placeholder="দোকানের নাম লিখুন"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#5A5A40] uppercase tracking-wider mb-1">মালিকের নাম</label>
                    <input 
                      name="name" 
                      type="text" 
                      required 
                      className="w-full bg-[#f5f5f0] border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                      placeholder="মালিকের নাম লিখুন"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#5A5A40] uppercase tracking-wider mb-1">ফোন নাম্বার</label>
                    <input 
                      name="phone" 
                      type="tel" 
                      required 
                      className="w-full bg-[#f5f5f0] border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                      placeholder="017XXXXXXXX"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-[#5A5A40] uppercase tracking-wider mb-1">ইমেইল এড্রেস</label>
                    <input 
                      name="email" 
                      type="email" 
                      required 
                      className="w-full bg-[#f5f5f0] border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                      placeholder="example@mail.com"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-[#5A5A40] uppercase tracking-wider mb-1">ইমেইল অথবা ফোন নাম্বার</label>
                  <input 
                    name="loginIdentifier" 
                    type="text" 
                    required 
                    className="w-full bg-[#f5f5f0] border-none rounded-2xl px-4 py-3 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                    placeholder="ইমেইল অথবা ফোন দিন"
                  />
                </div>
              )}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-bold text-[#5A5A40] uppercase tracking-wider">পাসওয়ার্ড</label>
                  {!isShopkeeperRegister && (
                    <button 
                      type="button"
                      onClick={() => { setIsForgotPassword(true); setIsShopkeeperLogin(false); }}
                      className="text-[10px] text-[#5A5A40] hover:underline font-bold"
                    >
                      পাসওয়ার্ড ভুলে গেছেন?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input 
                    name="password" 
                    type={showPassword ? "text" : "password"} 
                    required 
                    minLength={6}
                    className="w-full bg-[#f5f5f0] border-none rounded-2xl px-4 py-3 pr-12 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                    placeholder="******"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#5A5A40] hover:text-[#1a1a1a] transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <button 
                disabled={authLoading}
                className="w-full bg-[#5A5A40] text-white py-4 rounded-full font-bold hover:bg-[#4a4a35] transition-colors disabled:opacity-50"
              >
                {authLoading ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : (isShopkeeperRegister ? 'একাউন্ট তৈরি করুন' : 'লগইন করুন')}
              </button>
              <button 
                type="button"
                onClick={() => setIsShopkeeperRegister(!isShopkeeperRegister)}
                className="w-full text-sm text-[#5A5A40] font-bold hover:underline"
              >
                {isShopkeeperRegister ? 'ইতিমধ্যে একাউন্ট আছে? লগইন করুন' : 'নতুন দোকানদার একাউন্ট তৈরি করুন'}
              </button>
              <button 
                type="button"
                onClick={() => { setIsShopkeeperLogin(false); setIsShopkeeperRegister(false); }}
                className="w-full text-sm text-gray-400 hover:underline"
              >
                পিছনে যান
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <button 
                onClick={handleShopkeeperLogin}
                className="w-full bg-[#5A5A40] text-white py-4 rounded-full font-bold hover:bg-[#4a4a35] transition-colors flex items-center justify-center gap-3"
              >
                <Store className="w-6 h-6" />
                দোকানদার হিসেবে লগইন
              </button>
              <div className="flex items-center gap-4 py-2">
                <div className="flex-1 h-px bg-gray-200"></div>
                <span className="text-xs font-bold text-gray-400 uppercase">অথবা</span>
                <div className="flex-1 h-px bg-gray-200"></div>
              </div>
              <button 
                onClick={() => setIsCustomerLogin(true)}
                className="w-full bg-white border-2 border-[#5A5A40] text-[#5A5A40] py-4 rounded-full font-bold hover:bg-[#f5f5f0] transition-colors flex items-center justify-center gap-3"
              >
                <UserIcon className="w-6 h-6" />
                কাস্টমার হিসেবে লগইন
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] font-sans text-[#1a1a1a]">
      {toast && (
        <div className={cn(
          "fixed top-6 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-lg flex items-center gap-3 animate-in fade-in slide-in-from-top-4",
          toast.type === 'success' ? "bg-green-600 text-white" : "bg-red-600 text-white"
        )}>
          {toast.type === 'success' ? <Sparkles className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          <span className="font-bold">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 hover:opacity-70">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {/* Header */}
      <header className="bg-white border-b border-[#e5e5e0] sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {liveSelectedCustomer ? (
              <button onClick={() => setSelectedCustomer(null)} className="p-2 hover:bg-[#f5f5f0] rounded-full transition-colors">
                <ArrowLeft className="w-6 h-6" />
              </button>
            ) : (
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center overflow-hidden border border-[#e5e5e0]">
                <img 
                  src="https://ais-pre-jxad4a5s7krwbvf6rsouki-769162757935.asia-southeast1.run.app/api/attachments/40f69d2c-8094-4752-9599-5285741f2231" 
                  className="w-full h-full object-contain p-0.5" 
                  alt="Logo" 
                  referrerPolicy="no-referrer" 
                  onError={(e) => {
                    e.currentTarget.src = 'https://cdn-icons-png.flaticon.com/512/3081/3081840.png';
                  }}
                />
              </div>
            )}
            <h1 className="text-xl font-serif font-bold">
              {liveSelectedCustomer ? liveSelectedCustomer.name : 'রাজগঞ্জ সুপার শপ'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {(userRole === 'customer' || (userRole === 'shopkeeper' && liveSelectedCustomer)) && (
              <button 
                onClick={() => setIsViewingMessages(true)} 
                className="p-2 hover:bg-[#f5f5f0] rounded-full text-[#5A5A40] transition-colors relative"
                title="মেসেজ"
              >
                <MessageSquare className="w-5 h-5" />
                {inAppMessages.filter(m => !m.isRead && m.receiverId === user?.uid).length > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-[#5A5A40] text-white text-[10px] flex items-center justify-center rounded-full font-bold">
                    {inAppMessages.filter(m => !m.isRead && m.receiverId === user?.uid).length}
                  </span>
                )}
              </button>
            )}
            {(userRole === 'shopkeeper' || userRole === 'customer') && !liveSelectedCustomer && (
              <>
                <button 
                  onClick={() => setIsViewingNotifications(true)} 
                  className="p-2 hover:bg-[#f5f5f0] rounded-full text-[#5A5A40] transition-colors relative"
                  title="নোটিফিকেশন"
                >
                  <Bell className="w-5 h-5" />
                  {userRole === 'shopkeeper' ? (
                    (paymentNotifications.filter(n => n.status === 'pending').length + inAppMessages.filter(m => !m.isRead && m.receiverId === user?.uid).length) > 0 && (
                      <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] flex items-center justify-center rounded-full font-bold">
                        {paymentNotifications.filter(n => n.status === 'pending').length + inAppMessages.filter(m => !m.isRead && m.receiverId === user?.uid).length}
                      </span>
                    )
                  ) : (
                    (paymentNotifications.filter(n => !n.isRead && n.status !== 'pending').length + inAppMessages.filter(m => !m.isRead && m.receiverId === user?.uid).length) > 0 && (
                      <span className="absolute top-1 right-1 w-4 h-4 bg-[#5A5A40] text-white text-[10px] flex items-center justify-center rounded-full font-bold">
                        {paymentNotifications.filter(n => !n.isRead && n.status !== 'pending').length + inAppMessages.filter(m => !m.isRead && m.receiverId === user?.uid).length}
                      </span>
                    )
                  )}
                </button>
                {userRole === 'shopkeeper' && (
                  <button 
                    onClick={() => setIsEditingShopkeeperProfile(true)} 
                    className="p-2 hover:bg-[#f5f5f0] rounded-full text-[#5A5A40] transition-colors"
                    title="দোকানদার প্রোফাইল"
                  >
                    <UserIcon className="w-5 h-5" />
                  </button>
                )}
              </>
            )}
            <button onClick={logout} className="p-2 hover:bg-[#f5f5f0] rounded-full text-red-500 transition-colors">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 pb-32">
        {userRole === 'customer' ? (
          <>
            {/* Customer Profile Card */}
            <div className="bg-white p-8 rounded-[32px] border border-[#e5e5e0] shadow-sm mb-6 text-center relative">
              <button 
                onClick={() => setIsEditingProfile(true)}
                className="absolute top-6 right-6 p-2 hover:bg-[#f5f5f0] rounded-full text-[#5A5A40] transition-colors"
                title="প্রোফাইল এডিট করুন"
              >
                <Pencil className="w-5 h-5" />
              </button>
              <div className="w-24 h-24 rounded-full overflow-hidden mx-auto mb-4 border-4 border-[#f5f5f0]">
                {customerProfile?.photoUrl ? (
                  <img src={customerProfile.photoUrl} className="w-full h-full object-cover" alt={customerProfile.name} referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-full h-full bg-[#5A5A40] flex items-center justify-center text-white text-3xl font-bold">
                    {customerProfile?.name.charAt(0)}
                  </div>
                )}
              </div>
              <h2 className="text-2xl font-serif font-bold mb-1">{customerProfile?.name}</h2>
              <p className="text-[#5A5A40] text-sm mb-4">{customerProfile?.phone}</p>
              
              <div className="pt-4 border-t border-[#f5f5f0]">
                <p className="text-xs uppercase tracking-wider text-[#5A5A40] font-bold mb-1">আপনার বর্তমান ব্যালেন্স</p>
                <p className={cn(
                  "text-4xl font-bold",
                  (customerProfile?.totalBalance || 0) > 0 ? "text-green-600" : (customerProfile?.totalBalance || 0) < 0 ? "text-red-600" : "text-gray-400"
                )}>
                  ৳ {Math.abs(customerProfile?.totalBalance || 0).toLocaleString()}
                </p>
                <p className="text-sm font-serif italic text-[#5A5A40] mt-1">
                  {(customerProfile?.totalBalance || 0) > 0 ? 'আপনি টাকা দেবেন' : (customerProfile?.totalBalance || 0) < 0 ? 'আপনি টাকা পাবেন' : 'হিসাব সমান'}
                </p>
                {(customerProfile?.totalBalance || 0) > 0 && (
                  <button 
                    onClick={() => setIsSubmittingPayment(true)}
                    className="mt-4 w-full bg-[#5A5A40] text-white py-3 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-[#4A4A30] transition-colors"
                  >
                    <CreditCard className="w-5 h-5" />
                    বকেয়া পরিশোধ করুন
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-[#f5f5f0]">
                <div className="text-center">
                  <p className="text-[10px] uppercase font-bold text-[#5A5A40] mb-1">মোট জমা</p>
                  <p className="text-xl font-bold text-green-600">৳ {customerStats.deposit.toLocaleString()}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] uppercase font-bold text-[#5A5A40] mb-1">মোট খরচ</p>
                  <p className="text-xl font-bold text-red-600">৳ {customerStats.expense.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Payment Notifications History */}
            <div className="space-y-4 mb-8">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-sm font-bold text-[#5A5A40] uppercase tracking-wider">পেমেন্ট হিস্টরি</h3>
                <CreditCard className="w-4 h-4 text-[#5A5A40]" />
              </div>
              {paymentNotifications.length > 0 ? (
                paymentNotifications.map((n) => (
                  <div key={n.id} className="bg-white p-5 rounded-[24px] border border-[#e5e5e0] shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center",
                          n.status === 'approved' ? "bg-green-100 text-green-600" : 
                          n.status === 'rejected' ? "bg-red-100 text-red-600" : 
                          "bg-yellow-100 text-yellow-600"
                        )}>
                          {n.status === 'approved' ? <CheckCircle className="w-5 h-5" /> : 
                           n.status === 'rejected' ? <XCircle className="w-5 h-5" /> : 
                           <Clock className="w-5 h-5" />}
                        </div>
                        <div>
                          <p className="font-bold text-[#1a1a1a]">৳ {n.amount.toLocaleString()}</p>
                          <p className="text-[10px] text-[#5A5A40] uppercase font-bold">{n.method} • {format(n.timestamp.toDate(), 'd MMMM, yyyy', { locale: bn })}</p>
                        </div>
                      </div>
                      <div className={cn(
                        "px-3 py-1 rounded-full text-[10px] font-bold uppercase",
                        n.status === 'approved' ? "bg-green-100 text-green-600" : 
                        n.status === 'rejected' ? "bg-red-100 text-red-600" : 
                        "bg-yellow-100 text-yellow-600"
                      )}>
                        {n.status === 'approved' ? 'অনুমোদিত' : 
                         n.status === 'rejected' ? 'প্রত্যাখ্যাত' : 
                         'অপেক্ষমান'}
                      </div>
                    </div>
                    <div className="bg-[#f5f5f0] p-3 rounded-xl text-[10px] text-[#5A5A40]">
                      <p><span className="font-bold">ট্রানজেকশন আইডি:</span> {n.transactionId}</p>
                      <p><span className="font-bold">প্রেরকের ফোন:</span> {n.senderPhone}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 bg-white rounded-[24px] border border-dashed border-gray-300">
                  <p className="text-gray-400 text-sm italic">কোন পেমেন্ট হিস্টরি পাওয়া যায়নি</p>
                </div>
              )}
            </div>

            {/* Transactions List */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-sm font-bold text-[#5A5A40] uppercase tracking-wider">লেনদেনের ইতিহাস</h3>
                <History className="w-4 h-4 text-[#5A5A40]" />
              </div>
              {transactions.length > 0 ? (
                transactions.map((tx) => (
                  <div key={tx.id} className="bg-white p-5 rounded-[24px] border border-[#e5e5e0] shadow-sm flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center",
                        tx.type === 'credit' ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
                      )}>
                        {tx.type === 'credit' ? <ArrowUpRight className="w-6 h-6" /> : <ArrowDownLeft className="w-6 h-6" />}
                      </div>
                      <div>
                        <p className="font-bold text-[#1a1a1a]">{tx.note || (tx.type === 'credit' ? 'জমা' : 'খরচ')}</p>
                        <p className="text-xs text-[#5A5A40]">{format(tx.timestamp.toDate(), 'd MMMM, yyyy', { locale: bn })}</p>
                      </div>
                    </div>
                    <p className={cn(
                      "text-lg font-bold",
                      tx.type === 'credit' ? "text-green-600" : "text-red-600"
                    )}>
                      {tx.type === 'credit' ? '+' : '-'} ৳ {tx.amount.toLocaleString()}
                    </p>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 bg-white rounded-[32px] border border-dashed border-gray-300">
                  <p className="text-gray-400 font-serif italic">কোন লেনদেন পাওয়া যায়নি</p>
                </div>
              )}
            </div>

            {/* Shopkeeper Contact Footer */}
            {shopkeeperInfo && (
              <div className="mt-12 pt-8 border-t border-[#e5e5e0] text-center">
                <p className="text-xs uppercase tracking-wider text-[#5A5A40] font-bold mb-3">জরুরী প্রয়োজনে যোগাযোগ করুন</p>
                <div className="bg-white p-6 rounded-[24px] border border-[#e5e5e0] shadow-sm inline-block min-w-[280px]">
                  <p className="font-serif font-bold text-[#1a1a1a] mb-2">{shopkeeperInfo.name || 'দোকানদার'}</p>
                  <div className="space-y-2">
                    {shopkeeperInfo.phone && (
                      <div className="flex items-center justify-center gap-2 text-[#5A5A40]">
                        <Phone className="w-4 h-4" />
                        <a href={`tel:${shopkeeperInfo.phone}`} className="text-sm font-bold hover:underline">{shopkeeperInfo.phone}</a>
                      </div>
                    )}
                    {shopkeeperInfo.email && (
                      <div className="flex items-center justify-center gap-2 text-[#5A5A40]">
                        <AlertCircle className="w-4 h-4" />
                        <a href={`mailto:${shopkeeperInfo.email}`} className="text-sm hover:underline">{shopkeeperInfo.email}</a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : !liveSelectedCustomer ? (
          <>
            {/* Net Balance Summary */}
            <div className="bg-white p-8 rounded-[32px] border border-[#e5e5e0] shadow-sm mb-6 text-center">
              <p className="text-xs uppercase tracking-wider text-[#5A5A40] font-bold mb-2">মোট বর্তমান ব্যালেন্স</p>
              <p className={cn(
                "text-4xl font-bold mb-1",
                (totalPaben - totalDeben) > 0 ? "text-green-600" : (totalPaben - totalDeben) < 0 ? "text-red-600" : "text-gray-400"
              )}>
                ৳ {Math.abs(totalPaben - totalDeben).toLocaleString()}
              </p>
              <p className="text-sm font-serif italic text-[#5A5A40]">
                {(totalPaben - totalDeben) > 0 ? 'আপনি মোট টাকা পাবেন' : (totalPaben - totalDeben) < 0 ? 'আপনি মোট টাকা দেবেন' : 'হিসাব সমান'}
              </p>
            </div>

            {/* Detailed Summary Cards */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-white p-6 rounded-[24px] border border-[#e5e5e0] shadow-sm">
                <p className="text-xs uppercase tracking-wider text-[#5A5A40] font-bold mb-1">মোট পাবেন</p>
                <p className="text-2xl font-bold text-green-600">৳ {totalPaben.toLocaleString()}</p>
              </div>
              <div className="bg-white p-6 rounded-[24px] border border-[#e5e5e0] shadow-sm">
                <p className="text-xs uppercase tracking-wider text-[#5A5A40] font-bold mb-1">মোট দেবেন</p>
                <p className="text-2xl font-bold text-red-600">৳ {totalDeben.toLocaleString()}</p>
              </div>
            </div>

            {/* AI Input */}
            <div className="bg-white p-4 rounded-[24px] border border-[#e5e5e0] shadow-sm mb-8">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-[#5A5A40]" />
                <span className="text-xs font-bold text-[#5A5A40] uppercase tracking-wider">AI টালিখাতা (ভয়েস/টেক্সট)</span>
              </div>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder='যেমন: "রহিমকে ৫০০ টাকা বাকি দিলাম"'
                  className="flex-1 bg-[#f5f5f0] border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-[#5A5A40]"
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAiEntry()}
                />
                <button 
                  onClick={handleAiEntry}
                  disabled={isAiProcessing || !aiInput.trim()}
                  className="bg-[#5A5A40] text-white p-3 rounded-xl disabled:opacity-50"
                >
                  {isAiProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowUpRight className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Search and List */}
            <div className="relative mb-4">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#5A5A40] w-5 h-5" />
              <input 
                type="text" 
                placeholder="কাস্টমার খুঁজুন..."
                className="w-full bg-white border border-[#e5e5e0] rounded-full py-4 pl-12 pr-6 focus:ring-2 focus:ring-[#5A5A40] outline-none"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              {filteredCustomers.map(customer => (
                <div 
                  key={customer.id}
                  className="w-full bg-white p-4 rounded-[20px] border border-[#e5e5e0] flex items-center justify-between hover:border-[#5A5A40] transition-all group"
                >
                  <div className="flex items-center gap-4 flex-1 cursor-pointer" onClick={() => setSelectedCustomer(customer)}>
                    <div className="w-12 h-12 bg-[#f5f5f0] rounded-full flex items-center justify-center text-[#5A5A40] font-bold text-xl overflow-hidden">
                      {customer.photoUrl ? (
                        <img src={customer.photoUrl} alt={customer.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        customer.name[0]
                      )}
                    </div>
                    <div className="text-left">
                      <h3 className="font-bold text-[#1a1a1a]">{customer.name}</h3>
                      <p className="text-xs text-[#5A5A40] flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {customer.phone}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {customer.customerUid && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveConversationId(customer.customerUid!);
                          setIsViewingMessages(true);
                        }}
                        className="p-2 hover:bg-[#f5f5f0] rounded-full text-blue-600 transition-colors"
                        title="মেসেজ"
                      >
                        <MessageSquare className="w-5 h-5" />
                      </button>
                    )}
                    <div className="text-right cursor-pointer" onClick={() => setSelectedCustomer(customer)}>
                      <p className={cn(
                        "font-bold text-lg",
                        customer.totalBalance > 0 ? "text-green-600" : customer.totalBalance < 0 ? "text-red-600" : "text-gray-400"
                      )}>
                        ৳ {Math.abs(customer.totalBalance).toLocaleString()}
                      </p>
                      <p className="text-[10px] uppercase font-bold text-[#5A5A40] opacity-50">
                        {customer.totalBalance > 0 ? 'পাবেন' : customer.totalBalance < 0 ? 'দেবেন' : 'হিসাব সমান'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          /* Customer Detail View */
          <div className="space-y-6">
            <div className="bg-white p-8 rounded-[32px] border border-[#e5e5e0] shadow-sm text-center relative">
              <button 
                onClick={() => setIsEditingCustomer(true)}
                className="absolute top-6 right-6 p-2 hover:bg-[#f5f5f0] rounded-full text-[#5A5A40] transition-colors"
                title="এডিট করুন"
              >
                <Pencil className="w-5 h-5" />
              </button>
              <div className="w-24 h-24 bg-[#f5f5f0] rounded-full flex items-center justify-center text-[#5A5A40] font-bold text-3xl mx-auto mb-4 overflow-hidden">
                {liveSelectedCustomer.photoUrl ? (
                  <img src={liveSelectedCustomer.photoUrl} alt={liveSelectedCustomer.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  liveSelectedCustomer.name[0]
                )}
              </div>
              <h2 className="text-2xl font-bold mb-1">{liveSelectedCustomer.name}</h2>
              <div className="flex items-center justify-center gap-3 mb-2">
                <p className="text-[#5A5A40]">{liveSelectedCustomer.phone}</p>
                {liveSelectedCustomer.totalBalance > 0 && (
                  <button 
                    onClick={() => handleSendSMS(liveSelectedCustomer)}
                    className="flex items-center gap-1 text-[10px] font-bold bg-[#5A5A40] text-white px-2 py-1 rounded-full hover:bg-[#4a4a35] transition-all"
                  >
                    <MessageSquare className="w-3 h-3" /> SMS পাঠান
                  </button>
                )}
                {liveSelectedCustomer.customerUid && (
                  <button 
                    onClick={() => {
                      setActiveConversationId(liveSelectedCustomer.customerUid);
                      setIsViewingMessages(true);
                    }}
                    className="flex items-center gap-1 text-[10px] font-bold bg-blue-600 text-white px-2 py-1 rounded-full hover:bg-blue-700 transition-all"
                  >
                    <MessageSquare className="w-3 h-3" /> মেসেজ
                  </button>
                )}
              </div>
              {liveSelectedCustomer.address && (
                <p className="text-xs text-[#5A5A40] mb-6 italic">{liveSelectedCustomer.address}</p>
              )}
              
              <div className="grid grid-cols-3 gap-4 border-t border-[#f5f5f0] pt-6">
                <div>
                  <p className="text-[10px] uppercase font-bold text-[#5A5A40] mb-1">মোট জমা</p>
                  <p className="text-lg font-bold text-green-600">৳ {customerStats.deposit.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-[#5A5A40] mb-1">মোট খরচ</p>
                  <p className="text-lg font-bold text-red-600">৳ {customerStats.expense.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-[#5A5A40] mb-1">ব্যালেন্স</p>
                  <p className={cn(
                    "text-lg font-bold",
                    liveSelectedCustomer.totalBalance > 0 ? "text-green-600" : liveSelectedCustomer.totalBalance < 0 ? "text-red-600" : "text-gray-400"
                  )}>
                    ৳ {Math.abs(liveSelectedCustomer.totalBalance).toLocaleString()}
                  </p>
                  <p className="text-[10px] font-serif italic text-[#5A5A40]">
                    {liveSelectedCustomer.totalBalance > 0 ? 'পাবেন' : liveSelectedCustomer.totalBalance < 0 ? 'দেবেন' : 'সমান'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 px-2">
              <History className="w-4 h-4 text-[#5A5A40]" />
              <span className="text-xs font-bold text-[#5A5A40] uppercase tracking-wider">লেনদেনের ইতিহাস</span>
            </div>

            <div className="space-y-3">
              {transactions.map(tx => (
                <div key={tx.id} className="bg-white p-4 rounded-[20px] border border-[#e5e5e0] flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center",
                      tx.type === 'credit' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                    )}>
                      {tx.type === 'credit' ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownLeft className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="font-bold text-sm">{tx.note || (tx.type === 'credit' ? 'বাকি দেওয়া হয়েছে' : 'জমা নেওয়া হয়েছে')}</p>
                      <p className="text-[10px] text-[#5A5A40]">
                        {format(tx.timestamp.toDate(), 'd MMMM, yyyy • hh:mm a', { locale: bn })}
                      </p>
                    </div>
                  </div>
                  <p className={cn(
                    "font-bold",
                    tx.type === 'credit' ? "text-green-600" : "text-red-600"
                  )}>
                    {tx.type === 'credit' ? '+' : '-'} ৳{tx.amount.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Floating Action Buttons */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 flex gap-4">
        {userRole === 'shopkeeper' && !liveSelectedCustomer ? (
          <button 
            onClick={() => setIsAddingCustomer(true)}
            className="flex-1 bg-[#5A5A40] text-white py-4 rounded-full font-bold shadow-lg flex items-center justify-center gap-2 hover:bg-[#4a4a35] transition-all"
          >
            <Plus className="w-6 h-6" /> নতুন কাস্টমার
          </button>
        ) : userRole === 'shopkeeper' && liveSelectedCustomer ? (
          <>
            <button 
              onClick={() => setIsAddingTransaction(true)}
              className="flex-1 bg-red-600 text-white py-4 rounded-full font-bold shadow-lg flex items-center justify-center gap-2 hover:bg-red-700 transition-all"
            >
              <ArrowUpRight className="w-6 h-6" /> দিলাম (বাকি)
            </button>
            <button 
              onClick={() => setIsAddingTransaction(true)}
              className="flex-1 bg-green-600 text-white py-4 rounded-full font-bold shadow-lg flex items-center justify-center gap-2 hover:bg-green-700 transition-all"
            >
              <ArrowDownLeft className="w-6 h-6" /> পেলাম (জমা)
            </button>
          </>
        ) : null}
      </div>

      {/* Modals */}
      {isAddingCustomer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-serif font-bold">নতুন কাস্টমার যোগ করুন</h2>
              <button onClick={() => setIsAddingCustomer(false)} className="text-[#5A5A40] hover:bg-[#f5f5f0] p-2 rounded-full transition-colors">
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>
            <form onSubmit={handleAddCustomer} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">কাস্টমারের নাম</label>
                <input name="name" required className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">ফোন নম্বর</label>
                <input name="phone" required type="tel" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">ঠিকানা (ঐচ্ছিক)</label>
                <input name="address" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">প্রোফাইল ছবি</label>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-20 h-20 bg-[#f5f5f0] rounded-full flex items-center justify-center text-[#5A5A40] font-bold text-2xl overflow-hidden border-2 border-dashed border-[#5A5A40]">
                    {isUploading ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : tempPhotoUrl ? (
                      <img src={tempPhotoUrl} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <Camera className="w-8 h-8 opacity-30" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="bg-[#5A5A40] text-white px-4 py-2 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-2 hover:bg-[#4a4a35]">
                      <Upload className="w-4 h-4" /> ছবি আপলোড
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])} 
                      />
                    </label>
                    <label className="bg-white border border-[#5A5A40] text-[#5A5A40] px-4 py-2 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-2 hover:bg-[#f5f5f0]">
                      <Camera className="w-4 h-4" /> সরাসরি ছবি তুলুন
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment" 
                        className="hidden" 
                        onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])} 
                      />
                    </label>
                  </div>
                </div>
                <input name="photoUrl" placeholder="অথবা ছবির লিঙ্ক দিন (https://...)" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsAddingCustomer(false)} className="flex-1 py-4 font-bold text-[#5A5A40]">বাতিল</button>
                <button type="submit" className="flex-1 bg-[#5A5A40] text-white py-4 rounded-full font-bold">যোগ করুন</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isEditingCustomer && selectedCustomer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-serif font-bold">কাস্টমার এডিট করুন</h2>
              <button onClick={() => setIsEditingCustomer(false)} className="text-[#5A5A40] hover:bg-[#f5f5f0] p-2 rounded-full transition-colors">
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>
            <form onSubmit={handleEditCustomer} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">কাস্টমারের নাম</label>
                <input name="name" defaultValue={selectedCustomer.name} required className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">ফোন নম্বর</label>
                <input name="phone" defaultValue={selectedCustomer.phone} required type="tel" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">ঠিকানা</label>
                <input name="address" defaultValue={selectedCustomer.address} className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">প্রোফাইল ছবি</label>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-20 h-20 bg-[#f5f5f0] rounded-full flex items-center justify-center text-[#5A5A40] font-bold text-2xl overflow-hidden border-2 border-dashed border-[#5A5A40]">
                    {isUploading ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : (tempPhotoUrl || selectedCustomer.photoUrl) ? (
                      <img src={tempPhotoUrl || selectedCustomer.photoUrl} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <Camera className="w-8 h-8 opacity-30" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="bg-[#5A5A40] text-white px-4 py-2 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-2 hover:bg-[#4a4a35]">
                      <Upload className="w-4 h-4" /> ছবি আপলোড
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])} 
                      />
                    </label>
                    <label className="bg-white border border-[#5A5A40] text-[#5A5A40] px-4 py-2 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-2 hover:bg-[#f5f5f0]">
                      <Camera className="w-4 h-4" /> সরাসরি ছবি তুলুন
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment" 
                        className="hidden" 
                        onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])} 
                      />
                    </label>
                  </div>
                </div>
                <input name="photoUrl" defaultValue={selectedCustomer.photoUrl} placeholder="অথবা ছবির লিঙ্ক দিন (https://...)" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsDeletingCustomer(true)} className="flex-1 py-4 font-bold text-red-600 hover:bg-red-50 rounded-xl transition-colors">কাস্টমার ডিলিট</button>
                <button type="submit" className="flex-1 bg-[#5A5A40] text-white py-4 rounded-full font-bold">আপডেট করুন</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isDeletingCustomer && selectedCustomer && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-sm rounded-[32px] p-8 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold mb-2">কাস্টমার ডিলিট করবেন?</h2>
            <p className="text-[#5A5A40] text-sm mb-6">
              আপনি কি নিশ্চিত যে আপনি **{selectedCustomer.name}**-কে ডিলিট করতে চান? এর ফলে তার সকল লেনদেনের হিসাবও মুছে যাবে।
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setIsDeletingCustomer(false)} 
                className="flex-1 py-3 font-bold text-[#5A5A40] bg-[#f5f5f0] rounded-xl"
              >
                না, থাক
              </button>
              <button 
                onClick={handleDeleteCustomer} 
                className="flex-1 py-3 font-bold text-white bg-red-600 rounded-xl"
              >
                হ্যাঁ, ডিলিট করুন
              </button>
            </div>
          </div>
        </div>
      )}

      {isEditingProfile && customerProfile && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-serif font-bold">প্রোফাইল এডিট করুন</h2>
              <button onClick={() => setIsEditingProfile(false)} className="text-[#5A5A40] hover:bg-[#f5f5f0] p-2 rounded-full transition-colors">
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>
            <form onSubmit={handleEditProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">আপনার নাম</label>
                <input name="name" defaultValue={customerProfile.name} required className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">ঠিকানা</label>
                <input name="address" defaultValue={customerProfile.address} className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">প্রোফাইল ছবি</label>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-20 h-20 bg-[#f5f5f0] rounded-full flex items-center justify-center text-[#5A5A40] font-bold text-2xl overflow-hidden border-2 border-dashed border-[#5A5A40]">
                    {isUploading ? (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    ) : (tempPhotoUrl || customerProfile.photoUrl) ? (
                      <img src={tempPhotoUrl || customerProfile.photoUrl} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <Camera className="w-8 h-8 opacity-30" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="bg-[#5A5A40] text-white px-4 py-2 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-2 hover:bg-[#4a4a35]">
                      <Upload className="w-4 h-4" /> ছবি আপলোড
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])} 
                      />
                    </label>
                    <label className="bg-white border border-[#5A5A40] text-[#5A5A40] px-4 py-2 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-2 hover:bg-[#f5f5f0]">
                      <Camera className="w-4 h-4" /> সরাসরি ছবি তুলুন
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment" 
                        className="hidden" 
                        onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])} 
                      />
                    </label>
                  </div>
                </div>
                <input name="photoUrl" defaultValue={customerProfile.photoUrl} placeholder="অথবা ছবির লিঙ্ক দিন (https://...)" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsEditingProfile(false)} className="flex-1 py-4 font-bold text-[#5A5A40]">বাতিল</button>
                <button type="submit" className="flex-1 bg-[#5A5A40] text-white py-4 rounded-full font-bold">আপডেট করুন</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isEditingShopkeeperProfile && shopkeeperProfile && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-serif font-bold">দোকানদার প্রোফাইল</h2>
              <button onClick={() => setIsEditingShopkeeperProfile(false)} className="text-[#5A5A40] hover:bg-[#f5f5f0] p-2 rounded-full transition-colors">
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>
            <form onSubmit={handleEditShopkeeperProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">দোকানদারের নাম</label>
                <input name="name" defaultValue={shopkeeperProfile.name} required className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">জরুরী কন্টাক্ট নাম্বার</label>
                <input name="phone" defaultValue={shopkeeperProfile.phone} placeholder="যেমন: 017XXXXXXXX" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">ইমেইল</label>
                <input name="email" defaultValue={shopkeeperProfile.email} placeholder="যেমন: shop@example.com" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsEditingShopkeeperProfile(false)} className="flex-1 py-4 font-bold text-[#5A5A40]">বাতিল</button>
                <button type="submit" className="flex-1 bg-[#5A5A40] text-white py-4 rounded-full font-bold">সেভ করুন</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Submit Payment Modal (Customer) */}
      {isSubmittingPayment && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-serif font-bold">বকেয়া পরিশোধ করুন</h2>
              <button onClick={() => setIsSubmittingPayment(false)} className="text-[#5A5A40] hover:bg-[#f5f5f0] p-2 rounded-full transition-colors">
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>
            
            <div className="bg-[#f5f5f0] p-4 rounded-2xl mb-6 space-y-2">
              <p className="text-xs font-bold text-[#5A5A40] uppercase">পেমেন্ট করার মাধ্যমসমূহ (পার্সোনাল)</p>
              <div className="flex items-center justify-between">
                <span className="font-bold">বিকাশ:</span>
                <span className="font-mono text-[#5A5A40]">01736659058</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-bold">নগদ:</span>
                <span className="font-mono text-[#5A5A40]">01736659058</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-bold">রকেট:</span>
                <span className="font-mono text-[#5A5A40]">01736659058</span>
              </div>
            </div>

            <form onSubmit={handleSubmitPayment} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">টাকার পরিমাণ</label>
                <input name="amount" type="number" required placeholder="যেমন: 500" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">পেমেন্ট মেথড</label>
                <select name="method" required className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]">
                  <option value="bkash">বিকাশ</option>
                  <option value="nagad">নগদ</option>
                  <option value="rocket">রকেট</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">আপনার ফোন নাম্বার</label>
                <input name="senderPhone" required placeholder="যে নাম্বার থেকে টাকা পাঠিয়েছেন" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">ট্রানজেকশন আইডি / ট্র্যাকিং নাম্বার</label>
                <input name="transactionId" required placeholder="পেমেন্টের ট্রানজেকশন আইডি দিন" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsSubmittingPayment(false)} className="flex-1 py-4 font-bold text-[#5A5A40]">বাতিল</button>
                <button type="submit" className="flex-1 bg-[#5A5A40] text-white py-4 rounded-full font-bold">সাবমিট করুন</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Notifications Modal (Shopkeeper) */}
      {isViewingNotifications && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-2xl rounded-[32px] p-8 h-[85vh] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-serif font-bold">নোটিফিকেশন সেন্টার</h2>
              <button onClick={() => setIsViewingNotifications(false)} className="text-[#5A5A40] hover:bg-[#f5f5f0] p-2 rounded-full transition-colors">
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>

            {/* Tab Switcher */}
            <div className="flex bg-[#f5f5f0] p-1 rounded-2xl mb-6">
              <button 
                onClick={() => setActiveNotificationTab('payments')}
                className={cn(
                  "flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                  activeNotificationTab === 'payments' ? "bg-white text-[#5A5A40] shadow-sm" : "text-[#5A5A40] opacity-60"
                )}
              >
                <CreditCard className="w-4 h-4" /> পেমেন্ট
                {paymentNotifications.filter(n => n.status === 'pending').length > 0 && (
                  <span className="bg-red-500 text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full">
                    {paymentNotifications.filter(n => n.status === 'pending').length}
                  </span>
                )}
              </button>
              <button 
                onClick={() => setActiveNotificationTab('messages')}
                className={cn(
                  "flex-1 py-3 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2",
                  activeNotificationTab === 'messages' ? "bg-white text-[#5A5A40] shadow-sm" : "text-[#5A5A40] opacity-60"
                )}
              >
                <MessageSquare className="w-4 h-4" /> এসএমএস
                {inAppMessages.filter(m => !m.isRead && m.receiverId === user?.uid).length > 0 && (
                  <span className="bg-[#5A5A40] text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full">
                    {inAppMessages.filter(m => !m.isRead && m.receiverId === user?.uid).length}
                  </span>
                )}
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-4 pr-2">
              {activeNotificationTab === 'messages' ? (
                /* SMS / Messages Section */
                <div className="space-y-3">
                  {conversations.length > 0 ? (
                    conversations.map(c => (
                      <button 
                        key={c.otherId}
                        onClick={() => {
                          const customer = customers.find(cust => cust.customerUid === c.otherId);
                          if (customer) {
                            setSelectedCustomer(customer);
                            setIsViewingMessages(true);
                            setIsViewingNotifications(false);
                          }
                        }}
                        className="w-full bg-white p-4 rounded-[24px] border border-[#e5e5e0] flex items-center justify-between hover:border-[#5A5A40] transition-all group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-[#f5f5f0] rounded-full flex items-center justify-center text-[#5A5A40] font-bold group-hover:bg-[#5A5A40] group-hover:text-white transition-colors">
                            {c.name[0]}
                          </div>
                          <div className="text-left">
                            <p className="font-bold text-base">{c.name}</p>
                            <p className="text-xs text-[#5A5A40] line-clamp-1 opacity-70">{c.lastMessage.message}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <p className="text-[10px] text-[#5A5A40] opacity-60">
                            {format(c.lastMessage.timestamp.toDate(), 'd MMM', { locale: bn })}
                          </p>
                          {c.unreadCount > 0 && (
                            <span className="bg-[#5A5A40] text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-bold">
                              {c.unreadCount}
                            </span>
                          )}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="text-center py-12">
                      <p className="text-gray-400 font-serif italic">কোন মেসেজ পাওয়া যায়নি</p>
                    </div>
                  )}
                </div>
              ) : (
                /* Payments Section */
                <div className="space-y-4">
                  {paymentNotifications.length > 0 ? (
                    paymentNotifications.map((n) => (
                      <div key={n.id} className="bg-[#f5f5f0] p-5 rounded-[24px] border border-[#e5e5e0]">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <p className="font-bold text-lg">{n.customerName}</p>
                            <p className="text-xs text-[#5A5A40]">{format(n.timestamp.toDate(), 'd MMMM, yyyy h:mm a', { locale: bn })}</p>
                          </div>
                          <span className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                            n.status === 'pending' ? "bg-yellow-100 text-yellow-700" :
                            n.status === 'approved' ? "bg-green-100 text-green-700" :
                            "bg-red-100 text-red-700"
                          )}>
                            {n.status === 'pending' ? 'পেন্ডিং' : n.status === 'approved' ? 'অনুমোদিত' : 'প্রত্যাখ্যাত'}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                          <div>
                            <p className="text-[10px] uppercase font-bold text-[#5A5A40]">টাকার পরিমাণ</p>
                            <p className="font-bold text-green-600">৳ {n.amount.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase font-bold text-[#5A5A40]">মেথড</p>
                            <p className="font-bold capitalize">{n.method}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase font-bold text-[#5A5A40]">প্রেরকের ফোন</p>
                            <p className="font-bold">{n.senderPhone}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase font-bold text-[#5A5A40]">ট্রানজেকশন আইডি</p>
                            <p className="font-mono text-xs font-bold">{n.transactionId}</p>
                          </div>
                        </div>
                        {n.status === 'pending' && (
                          <div className="flex gap-2">
                            <button 
                              onClick={() => handleUpdateNotificationStatus(n, 'rejected')}
                              className="flex-1 py-2 rounded-xl font-bold text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
                            >
                              প্রত্যাখ্যান
                            </button>
                            <button 
                              onClick={() => handleUpdateNotificationStatus(n, 'approved')}
                              className="flex-1 bg-green-600 text-white py-2 rounded-xl font-bold hover:bg-green-700 transition-colors"
                            >
                              অনুমোদন
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12">
                      <p className="text-gray-400 font-serif italic">কোন নোটিফিকেশন পাওয়া যায়নি</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* View Messages Modal */}
      {isViewingMessages && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-2xl rounded-[32px] p-8 h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                {activeConversationId && userRole === 'shopkeeper' && !liveSelectedCustomer && (
                  <button onClick={() => setActiveConversationId(null)} className="p-2 hover:bg-[#f5f5f0] rounded-full text-[#5A5A40] transition-colors">
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <h2 className="text-2xl font-serif font-bold">
                  {activeConversationId ? (
                    conversations.find(c => c.otherId === activeConversationId)?.name || 'মেসেজ'
                  ) : 'মেসেজ বক্স'}
                </h2>
              </div>
              <button onClick={() => { setIsViewingMessages(false); setActiveConversationId(null); }} className="text-[#5A5A40] hover:bg-[#f5f5f0] p-2 rounded-full transition-colors">
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              {activeConversationId ? (
                /* Chat Window */
                <>
                  <div 
                    ref={chatScrollRef}
                    className="flex-1 overflow-y-auto space-y-4 pr-2 mb-4 scroll-smooth"
                  >
                    {inAppMessages
                      .filter(m => 
                        (m.senderId === user?.uid && m.receiverId === activeConversationId) || 
                        (m.senderId === activeConversationId && m.receiverId === user?.uid)
                      )
                      .map((m) => (
                        <div 
                          key={m.id} 
                          className={cn(
                            "flex flex-col max-w-[85%]",
                            m.senderId === user?.uid ? "ml-auto items-end" : "mr-auto items-start"
                          )}
                          onMouseEnter={() => !m.isRead && m.receiverId === user?.uid && handleMarkMessageAsRead(m.id)}
                          onTouchStart={() => !m.isRead && m.receiverId === user?.uid && handleMarkMessageAsRead(m.id)}
                        >
                          <div className={cn(
                            "p-3.5 rounded-[20px] text-sm shadow-sm",
                            m.senderId === user?.uid ? "bg-[#5A5A40] text-white rounded-tr-none" : "bg-[#f5f5f0] text-[#1a1a1a] rounded-tl-none"
                          )}>
                            {m.message}
                          </div>
                          <div className="flex items-center gap-1 mt-1 px-1">
                            <p className="text-[9px] text-[#5A5A40] opacity-60">
                              {format(m.timestamp.toDate(), 'h:mm a', { locale: bn })}
                            </p>
                            {m.senderId === user?.uid && (
                              <span className={cn(
                                "text-[9px] font-bold",
                                m.isRead ? "text-blue-500" : "text-gray-400"
                              )}>
                                • {m.isRead ? 'Seen' : 'Unseen'}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                  <form 
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input = e.currentTarget.elements.namedItem('reply') as HTMLTextAreaElement;
                      const reply = input.value;
                      handleReplyMessage(activeConversationId, reply);
                      input.value = '';
                    }}
                    className="flex flex-col gap-2 bg-[#f5f5f0] p-3 rounded-2xl border border-[#e5e5e0]"
                  >
                    <textarea 
                      name="reply" 
                      placeholder="মেসেজ লিখুন..." 
                      required 
                      autoFocus
                      autoComplete="off"
                      rows={2}
                      className="w-full bg-transparent border-none px-2 py-1 text-sm outline-none resize-none" 
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.shiftKey) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <div className="flex justify-end border-t border-[#e5e5e0] pt-2">
                      <button 
                        type="submit" 
                        className="bg-[#5A5A40] text-white px-6 py-2.5 rounded-xl shadow-md active:scale-95 transition-transform flex items-center gap-2 font-bold text-sm"
                        title="পাঠান"
                      >
                        পাঠান <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </form>
                </>
              ) : liveSelectedCustomer ? (
                /* Not Linked Message */
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <div className="w-20 h-20 bg-[#f5f5f0] rounded-full flex items-center justify-center mb-4">
                    <MessageSquare className="w-10 h-10 text-[#5A5A40] opacity-20" />
                  </div>
                  <h3 className="text-lg font-serif font-bold mb-2">চ্যাট উপলব্ধ নয়</h3>
                  <p className="text-sm text-[#5A5A40] opacity-70">
                    এই কাস্টমার এখনো অ্যাপে রেজিস্ট্রেশন করেননি। কাস্টমার রেজিস্ট্রেশন করলে আপনি তার সাথে চ্যাট করতে পারবেন।
                  </p>
                </div>
              ) : (
                /* Conversation List (Shopkeeper) */
                <div className="overflow-y-auto space-y-2 pr-2">
                  {conversations.length > 0 ? (
                    conversations.map((c) => (
                      <button 
                        key={c.otherId} 
                        onClick={() => setActiveConversationId(c.otherId)}
                        className="w-full text-left p-5 rounded-[24px] border border-[#e5e5e0] hover:bg-[#f5f5f0] transition-all flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-full bg-[#5A5A40]/10 flex items-center justify-center text-[#5A5A40] font-bold">
                            {c.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-lg group-hover:text-[#5A5A40] transition-colors">{c.name}</p>
                            <p className="text-xs text-[#5A5A40] opacity-70 truncate max-w-[200px]">{c.lastMessage.message}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-[#5A5A40] mb-1">{format(c.lastMessage.timestamp.toDate(), 'd MMM', { locale: bn })}</p>
                          {c.unreadCount > 0 && (
                            <span className="bg-[#5A5A40] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                              {c.unreadCount} নতুন
                            </span>
                          )}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="text-center py-20">
                      <MessageSquare className="w-12 h-12 text-[#5A5A40]/20 mx-auto mb-4" />
                      <p className="text-gray-400 font-serif italic">কোন মেসেজ পাওয়া যায়নি</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {imageToCrop && (
        <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col items-center justify-center p-4">
          <div className="relative w-full max-w-md aspect-square bg-black rounded-2xl overflow-hidden mb-6">
            <Cropper
              image={imageToCrop}
              crop={crop}
              zoom={zoom}
              aspect={1}
              onCropChange={setCrop}
              onCropComplete={onCropComplete}
              onZoomChange={setZoom}
            />
          </div>
          
          <div className="w-full max-w-md bg-white rounded-3xl p-6">
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">জুম করুন</label>
              <input
                type="range"
                value={zoom}
                min={1}
                max={3}
                step={0.1}
                aria-labelledby="Zoom"
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#5A5A40]"
              />
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => setImageToCrop(null)}
                className="flex-1 py-4 font-bold text-[#5A5A40] bg-[#f5f5f0] rounded-2xl"
              >
                বাতিল
              </button>
              <button
                onClick={handleCropSave}
                disabled={isUploading}
                className="flex-1 py-4 font-bold text-white bg-[#5A5A40] rounded-2xl flex items-center justify-center gap-2"
              >
                {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Crop className="w-5 h-5" />}
                ক্রপ ও সেভ
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddingTransaction && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-serif font-bold">লেনদেন যোগ করুন</h2>
              <button onClick={() => setIsAddingTransaction(false)} className="text-[#5A5A40] hover:bg-[#f5f5f0] p-2 rounded-full transition-colors">
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const amount = parseFloat(formData.get('amount') as string);
              const note = formData.get('note') as string;
              const type = formData.get('type') as 'credit' | 'debit';
              handleAddTransaction(amount, type, note);
            }} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">টাকার পরিমাণ</label>
                <input name="amount" required type="number" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 text-2xl font-bold outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">লেনদেনের ধরন</label>
                <select name="type" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]">
                  <option value="credit">দিলাম (বাকি)</option>
                  <option value="debit">পেলাম (জমা)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-[#5A5A40] uppercase mb-2">নোট (ঐচ্ছিক)</label>
                <input name="note" className="w-full bg-[#f5f5f0] border-none rounded-xl p-4 outline-none focus:ring-2 focus:ring-[#5A5A40]" />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsAddingTransaction(false)} className="flex-1 py-4 font-bold text-[#5A5A40]">বাতিল</button>
                <button type="submit" className="flex-1 bg-[#5A5A40] text-white py-4 rounded-full font-bold">সেভ করুন</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
