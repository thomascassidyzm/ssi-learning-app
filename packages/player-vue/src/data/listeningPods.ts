/**
 * Listening Pods — Podcast-style comprehensible input
 *
 * Each pod is a real-world scene (coffee shop, restaurant, etc.)
 * broken into individual sentences. Each sentence goes through
 * a 7-stage scaffolding pattern that progressively removes support:
 *
 * Stage 1: Slow → Translation → Slow → Fast  (x3)
 * Stage 2: Slow → Translation → Fast          (x3)
 * Stage 3: Slow → Translation → Fast → Fast   (x3)
 * Stage 4: Fast → Translation → Fast           (x3)
 * Stage 5: Slow → Fast                         (x3)
 * Stage 6: Fast → Fast                         (x3)
 * Stage 7: Fast                                (x1, graduated)
 *
 * Slow = 0.8x playback rate
 * Fast = 1.6x playback rate
 * All from a single audio recording per sentence.
 */

export interface PodSentence {
  id: number
  speaker: string
  target: string   // Spanish
  known: string    // English translation
  /** Audio ID — will be populated when TTS audio is generated */
  audioId?: string
}

export interface ListeningPod {
  id: number
  slug: string
  title: string
  scene: string
  difficulty: 'beginner' | 'beginner-intermediate' | 'intermediate'
  sentences: PodSentence[]
}

export interface PodCollection {
  courseCode: string
  knownLanguage: string
  targetLanguage: string
  pods: ListeningPod[]
}

// ============================================================================
// 7-Stage Scaffolding Definition
// ============================================================================

export type PlaybackSpeed = 0.8 | 1.6

export interface StageStep {
  type: 'target' | 'translation'
  speed?: PlaybackSpeed  // only for 'target' steps
}

export interface ScaffoldingStage {
  stage: number
  repeats: number
  steps: StageStep[]
}

export const SCAFFOLDING_STAGES: ScaffoldingStage[] = [
  {
    stage: 1,
    repeats: 3,
    steps: [
      { type: 'target', speed: 0.8 },
      { type: 'translation' },
      { type: 'target', speed: 0.8 },
      { type: 'target', speed: 1.6 },
    ],
  },
  {
    stage: 2,
    repeats: 3,
    steps: [
      { type: 'target', speed: 0.8 },
      { type: 'translation' },
      { type: 'target', speed: 1.6 },
    ],
  },
  {
    stage: 3,
    repeats: 3,
    steps: [
      { type: 'target', speed: 0.8 },
      { type: 'translation' },
      { type: 'target', speed: 1.6 },
      { type: 'target', speed: 1.6 },
    ],
  },
  {
    stage: 4,
    repeats: 3,
    steps: [
      { type: 'target', speed: 1.6 },
      { type: 'translation' },
      { type: 'target', speed: 1.6 },
    ],
  },
  {
    stage: 5,
    repeats: 3,
    steps: [
      { type: 'target', speed: 0.8 },
      { type: 'target', speed: 1.6 },
    ],
  },
  {
    stage: 6,
    repeats: 3,
    steps: [
      { type: 'target', speed: 1.6 },
      { type: 'target', speed: 1.6 },
    ],
  },
  {
    stage: 7,
    repeats: 1,
    steps: [
      { type: 'target', speed: 1.6 },
    ],
  },
]

// ============================================================================
// Spanish for English Speakers — 8 Pods
// ============================================================================

export const SPANISH_PODS: PodCollection = {
  courseCode: 'spa_pods_for_eng',
  knownLanguage: 'en',
  targetLanguage: 'es',
  pods: [
    // Pod 1: Coffee Shop
    {
      id: 1,
      slug: 'coffee-shop',
      title: 'Un café, por favor',
      scene: 'Coffee Shop',
      difficulty: 'beginner',
      sentences: [
        { id: 1, speaker: 'Barista', target: '¡Buenos días! ¿Qué le pongo?', known: 'Good morning! What can I get you?' },
        { id: 2, speaker: 'Customer', target: 'Un café con leche, por favor.', known: 'A coffee with milk, please.' },
        { id: 3, speaker: 'Barista', target: '¿Grande o pequeño?', known: 'Large or small?' },
        { id: 4, speaker: 'Customer', target: 'Grande, por favor.', known: 'Large, please.' },
        { id: 5, speaker: 'Barista', target: '¿Para tomar aquí o para llevar?', known: 'For here or to go?' },
        { id: 6, speaker: 'Barista', target: 'Para llevar. Son tres euros con cincuenta.', known: 'To go. That\'s three euros fifty.' },
      ],
    },

    // Pod 2: Bar
    {
      id: 2,
      slug: 'bar',
      title: 'Una caña',
      scene: 'Bar',
      difficulty: 'beginner',
      sentences: [
        { id: 1, speaker: 'Bartender', target: '¡Buenas tardes! ¿Qué van a tomar?', known: 'Good evening! What are you going to have?' },
        { id: 2, speaker: 'Customer', target: 'Yo quiero una caña, por favor.', known: 'I\'d like a small beer, please.' },
        { id: 3, speaker: 'Customer 2', target: 'Y para mí, un vino tinto.', known: 'And for me, a red wine.' },
        { id: 4, speaker: 'Bartender', target: '¿Quieren algo para picar?', known: 'Do you want something to snack on?' },
        { id: 5, speaker: 'Customer', target: '¿Qué tapas tienen?', known: 'What tapas do you have?' },
        { id: 6, speaker: 'Bartender', target: 'Tenemos tortilla, patatas bravas y jamón.', known: 'We have tortilla, patatas bravas and ham.' },
        { id: 7, speaker: 'Customer', target: 'Ponme unas patatas bravas.', known: 'Give me some patatas bravas.' },
        { id: 8, speaker: 'Bartender', target: 'Muy bien, ahora mismo.', known: 'Very good, right away.' },
      ],
    },

    // Pod 3: Restaurant
    {
      id: 3,
      slug: 'restaurant',
      title: 'Una mesa para dos',
      scene: 'Restaurant',
      difficulty: 'intermediate',
      sentences: [
        { id: 1, speaker: 'Customer', target: 'Buenas noches. ¿Tienen mesa para dos?', known: 'Good evening. Do you have a table for two?' },
        { id: 2, speaker: 'Waiter', target: 'Sí, por aquí, por favor. Les traigo la carta.', known: 'Yes, this way please. I\'ll bring you the menu.' },
        { id: 3, speaker: 'Customer', target: '¿Qué nos recomienda?', known: 'What do you recommend?' },
        { id: 4, speaker: 'Waiter', target: 'El pescado del día está muy bueno.', known: 'The fish of the day is very good.' },
        { id: 5, speaker: 'Customer 1', target: 'Vale, yo quiero el pescado.', known: 'OK, I\'ll have the fish.' },
        { id: 6, speaker: 'Customer 2', target: 'Y yo, la ensalada y un filete.', known: 'And I\'ll have the salad and a steak.' },
        { id: 7, speaker: 'Waiter', target: '¿Cómo quiere el filete? ¿Poco hecho, al punto o muy hecho?', known: 'How do you want the steak? Rare, medium or well done?' },
        { id: 8, speaker: 'Customer', target: 'Al punto, por favor.', known: 'Medium, please.' },
        { id: 9, speaker: 'Waiter', target: '¿Y para beber?', known: 'And to drink?' },
        { id: 10, speaker: 'Customer', target: 'Una botella de agua y una copa de vino blanco.', known: 'A bottle of water and a glass of white wine.' },
        { id: 11, speaker: 'Waiter', target: '¿Quieren postre o café?', known: 'Would you like dessert or coffee?' },
        { id: 12, speaker: 'Customer', target: 'No, gracias. La cuenta, por favor.', known: 'No, thank you. The bill, please.' },
      ],
    },

    // Pod 4: Market
    {
      id: 4,
      slug: 'market',
      title: '¿Cuánto cuesta?',
      scene: 'Market',
      difficulty: 'beginner-intermediate',
      sentences: [
        { id: 1, speaker: 'Vendor', target: '¡Hola! ¿Qué le pongo?', known: 'Hello! What can I get you?' },
        { id: 2, speaker: 'Customer', target: '¿Cuánto cuestan las naranjas?', known: 'How much are the oranges?' },
        { id: 3, speaker: 'Vendor', target: 'A dos euros el kilo.', known: 'Two euros a kilo.' },
        { id: 4, speaker: 'Customer', target: 'Ponme un kilo de naranjas y medio kilo de fresas.', known: 'Give me a kilo of oranges and half a kilo of strawberries.' },
        { id: 5, speaker: 'Vendor', target: '¿Algo más?', known: 'Anything else?' },
        { id: 6, speaker: 'Customer', target: 'Sí, ¿tiene aguacates?', known: 'Yes, do you have avocados?' },
        { id: 7, speaker: 'Vendor', target: 'Hoy no me quedan, lo siento.', known: 'I don\'t have any left today, sorry.' },
        { id: 8, speaker: 'Customer + Vendor', target: 'No pasa nada. ¿Cuánto es todo? Son cinco euros con veinte.', known: 'No worries. How much is everything? That\'s five euros twenty.' },
      ],
    },

    // Pod 5: Hotel
    {
      id: 5,
      slug: 'hotel',
      title: 'Tengo una reserva',
      scene: 'Hotel',
      difficulty: 'intermediate',
      sentences: [
        { id: 1, speaker: 'Guest', target: 'Buenas tardes. Tengo una reserva a nombre de García.', known: 'Good afternoon. I have a reservation under the name García.' },
        { id: 2, speaker: 'Receptionist', target: 'Un momento, por favor. Sí, una habitación doble para tres noches.', known: 'One moment, please. Yes, a double room for three nights.' },
        { id: 3, speaker: 'Guest', target: '¿La habitación tiene vistas al mar?', known: 'Does the room have a sea view?' },
        { id: 4, speaker: 'Receptionist', target: 'Sí, está en la quinta planta. Aquí tiene la llave.', known: 'Yes, it\'s on the fifth floor. Here\'s the key.' },
        { id: 5, speaker: 'Guest', target: '¿A qué hora es el desayuno?', known: 'What time is breakfast?' },
        { id: 6, speaker: 'Receptionist', target: 'De siete a diez, en el restaurante de la planta baja.', known: 'From seven to ten, in the ground floor restaurant.' },
        { id: 7, speaker: 'Guest', target: '¿Tienen piscina?', known: 'Do you have a pool?' },
        { id: 8, speaker: 'Receptionist', target: 'Sí, la piscina está en la azotea. Abre a las nueve.', known: 'Yes, the pool is on the rooftop. It opens at nine.' },
        { id: 9, speaker: 'Guest', target: 'Perfecto. ¿Y el wifi? ¿Cuál es la contraseña?', known: 'Perfect. And the wifi? What\'s the password?' },
        { id: 10, speaker: 'Receptionist', target: 'La contraseña está en la tarjeta de la habitación.', known: 'The password is on the room card.' },
      ],
    },

    // Pod 6: Pharmacy
    {
      id: 6,
      slug: 'pharmacy',
      title: 'Necesito algo para...',
      scene: 'Pharmacy',
      difficulty: 'intermediate',
      sentences: [
        { id: 1, speaker: 'Customer', target: 'Hola, buenas. Necesito algo para el dolor de cabeza.', known: 'Hello. I need something for a headache.' },
        { id: 2, speaker: 'Pharmacist', target: '¿Es un dolor fuerte o leve?', known: 'Is it a strong or mild pain?' },
        { id: 3, speaker: 'Customer', target: 'Bastante fuerte. Me duele desde esta mañana.', known: 'Quite strong. It\'s been hurting since this morning.' },
        { id: 4, speaker: 'Pharmacist', target: 'Le recomiendo este ibuprofeno. Tome uno cada ocho horas.', known: 'I recommend this ibuprofen. Take one every eight hours.' },
        { id: 5, speaker: 'Customer', target: '¿Tiene algo también para el estómago? Me sienta mal la comida.', known: 'Do you have something for my stomach too? The food disagreed with me.' },
        { id: 6, speaker: 'Pharmacist', target: 'Sí, estas pastillas van muy bien. Tómelas antes de comer.', known: 'Yes, these tablets work very well. Take them before eating.' },
        { id: 7, speaker: 'Customer', target: 'Muchas gracias. ¿Cuánto es todo?', known: 'Thank you very much. How much is everything?' },
      ],
    },

    // Pod 7: Directions
    {
      id: 7,
      slug: 'directions',
      title: '¿Cómo llego a...?',
      scene: 'Directions',
      difficulty: 'intermediate',
      sentences: [
        { id: 1, speaker: 'Tourist', target: 'Perdone, ¿sabe dónde está la estación de metro?', known: 'Excuse me, do you know where the metro station is?' },
        { id: 2, speaker: 'Local', target: 'Sí, siga todo recto por esta calle.', known: 'Yes, go straight ahead along this street.' },
        { id: 3, speaker: 'Tourist', target: '¿Está lejos?', known: 'Is it far?' },
        { id: 4, speaker: 'Local', target: 'No, a unos cinco minutos andando.', known: 'No, about five minutes walking.' },
        { id: 5, speaker: 'Local', target: 'Al final de la calle, gire a la izquierda.', known: 'At the end of the street, turn left.' },
        { id: 6, speaker: 'Local', target: 'La estación está justo enfrente del supermercado.', known: 'The station is right opposite the supermarket.' },
        { id: 7, speaker: 'Tourist', target: '¿Y hay algún cajero automático por aquí cerca?', known: 'And is there a cash machine near here?' },
        { id: 8, speaker: 'Local', target: 'Sí, hay uno en la esquina, al lado del banco.', known: 'Yes, there\'s one on the corner, next to the bank.' },
      ],
    },

    // Pod 8: Taxi
    {
      id: 8,
      slug: 'taxi',
      title: 'Al centro, por favor',
      scene: 'Taxi',
      difficulty: 'beginner-intermediate',
      sentences: [
        { id: 1, speaker: 'Passenger', target: '¡Hola! Al centro de la ciudad, por favor.', known: 'Hello! To the city centre, please.' },
        { id: 2, speaker: 'Driver', target: '¿A qué calle exactamente?', known: 'To which street exactly?' },
        { id: 3, speaker: 'Passenger', target: 'A la Plaza Mayor, si puede.', known: 'To the Plaza Mayor, if you can.' },
        { id: 4, speaker: 'Driver', target: 'Muy bien. A esta hora hay bastante tráfico.', known: 'Very good. There\'s quite a lot of traffic at this time.' },
        { id: 5, speaker: 'Passenger', target: '¿Cuánto tiempo tardamos más o menos?', known: 'How long will it take, more or less?' },
        { id: 6, speaker: 'Driver', target: 'Unos veinte minutos, depende del tráfico.', known: 'About twenty minutes, it depends on the traffic.' },
        { id: 7, speaker: 'Driver', target: 'Ya hemos llegado. Son doce euros con setenta.', known: 'We\'ve arrived. That\'s twelve euros seventy.' },
      ],
    },
  ],
}
