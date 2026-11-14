// 레벨테스트 문제 은행: 토익스피킹 문항 유형별로 학교·일상(비즈니스 아님) 문제를 일반·쉬움 난이도마다 여러 개.
// 시험마다 유형별로 하나씩 섞어 고르고(lib/level.js pickItems), 같은 응시자가 최근에 푼 문제는 다시 내지 않는다.
// id는 바꾸지 않는다 (최근에 푼 문제 기록에 쓴다).

/** 1. 문장 읽기 (Read a text aloud) */
export const READ = {
  normal: [
    [
      'r1',
      'Welcome to the Riverside Public Library. Our reading room is open from nine in the morning until eight in the evening. Please keep your voice down, and remember that food and drinks are not allowed near the bookshelves. If you need help finding a book, our friendly staff at the front desk will be happy to assist you.',
    ],
    [
      'r2',
      'Good morning, students. This is a reminder that the school sports day will be held this Friday on the main field. Please wear comfortable clothes and bring a water bottle. If it rains, the event will move to the gym. Parents and family members are also welcome to come and cheer for their children.',
    ],
    [
      'r3',
      'Thank you for shopping at Green Valley Market. Today, fresh strawberries, local carrots, and homemade bread are on sale until six o’clock. Don’t forget to bring your own shopping bag, because plastic bags are no longer free. We hope you enjoy your visit and have a wonderful afternoon.',
    ],
    [
      'r4',
      'Attention, passengers. The train to Central Station will arrive on platform three in about five minutes. Please stand behind the yellow line and let other passengers get off before you get on. For your safety, keep an eye on your belongings and hold the handrail while the train is moving.',
    ],
    [
      'r5',
      'Are you looking for a fun way to stay healthy this spring? Join our weekend walking club at Lakeside Park. Every Saturday morning, we walk around the lake, talk with new friends, and enjoy the fresh air. The club is free, and people of all ages are welcome. Just bring good shoes and a smile.',
    ],
    [
      'r6',
      'Hello, everyone, and welcome to our cooking class. Today, we are going to make a simple vegetable soup. First, wash and cut the carrots, onions, and potatoes. Next, put them in a large pot with water and a little salt. Finally, let the soup cook slowly for about thirty minutes.',
    ],
    [
      'r7',
      'This is an announcement from the city sports center. The swimming pool will be closed next Monday and Tuesday for cleaning. During this time, the gym, the tennis courts, and the yoga room will stay open as usual. We are sorry for any trouble, and we thank you for your understanding.',
    ],
    [
      'r8',
      "Welcome to the Hillside Science Museum. On the first floor, you can learn about dinosaurs, stars, and the human body. On the second floor, there is a special show about the ocean every hour. Please don't touch the glass cases, and feel free to ask our guides any questions you may have.",
    ],
    [
      'r9',
      'Good evening, and thank you for coming to our school concert. Tonight, the students will play music from different countries and different times. The program will last about ninety minutes, with a short break in the middle. Please turn off your phones and enjoy the wonderful sounds of our young musicians.',
    ],
    [
      'r10',
      'Our apartment building will hold a recycling day this Sunday. Please sort paper, glass, cans, and plastic into the right boxes in the parking area. Old clothes and small electronics can also be dropped off between ten and two. Let’s work together to keep our building clean and our neighborhood green.',
    ],
    [
      'r11',
      'Are you planning a trip this summer? The tourist information center at Seaside Station offers free maps, bus schedules, and tips on local restaurants. Our staff can also help you book a hotel or a boat tour. We are open every day from eight in the morning until seven at night.',
    ],
    [
      'r12',
      'Welcome to Sunny Days Cafe. All of our cakes, cookies, and sandwiches are made fresh every morning. If you sit by the window, you can enjoy a beautiful view of the river. Free Wi-Fi is available for all customers, and the password is printed on the back of your receipt.',
    ],
  ],
  easy: [
    [
      're1',
      'Welcome to the city library. We are open every day from nine to six. Please be quiet in the reading room. You can borrow up to five books for two weeks.',
    ],
    [
      're2',
      'Hello, students. The school picnic is this Friday. We will meet at the main gate at nine. Please bring lunch, water, and a hat. See you there!',
    ],
    [
      're3',
      'Thank you for shopping with us today. Fresh apples and bananas are on sale. Please bring your own bag. Have a nice day!',
    ],
    [
      're4',
      'The next bus will arrive in three minutes. Please wait behind the line. Let people get off first. Thank you and have a safe trip.',
    ],
    [
      're5',
      'Our park will have a music festival this weekend. There will be food, games, and live music. It is free for everyone. Come and have fun with your family.',
    ],
    [
      're6',
      'Good morning, everyone. Today we will learn how to make pancakes. First, mix the flour, milk, and eggs. Then, cook them in a hot pan.',
    ],
    [
      're7',
      'The swimming pool is closed on Monday for cleaning. The gym and the tennis courts are open as usual. We are sorry for the trouble.',
    ],
    [
      're8',
      'Welcome to our zoo. You can see lions, monkeys, and elephants. Please do not feed the animals. The gift shop is near the main gate.',
    ],
    [
      're9',
      'Thank you for coming to our school concert. The show will start in five minutes. Please turn off your phones. Enjoy the music!',
    ],
    [
      're10',
      'This Sunday is cleaning day in our building. Please put paper, cans, and bottles in the right boxes. Let’s keep our home clean together.',
    ],
    [
      're11',
      'Welcome to the tourist center. We have free maps and bus times. Our staff can help you find a hotel. We are open from eight to seven.',
    ],
    [
      're12',
      'Welcome to our cafe. Our cakes and cookies are made fresh every day. Free Wi-Fi is available. Please ask us for the password.',
    ],
  ],
};

/** 2. 사진 묘사 (Describe a picture): 앱에 넣어 둔 사진 [id, 파일, 장면 설명(채점에 알려 주고 사진이 없을 때 대신 보여 줌), 출처] */
export const PICTURES = [
  ['p1', 'samples/pictures/p1.jpg', 'students studying together at a table in a library', ''],
  ['p2', 'samples/pictures/p2.jpg', 'a family having a picnic on the grass in a park', ''],
  ['p3', 'samples/pictures/p3.jpg', 'people waiting at a bus stop on a city street', ''],
  ['p4', 'samples/pictures/p4.jpg', 'people buying vegetables at an outdoor market', ''],
  ['p5', 'samples/pictures/p5.jpg', 'children playing at a playground', ''],
  ['p6', 'samples/pictures/p6.jpg', 'a barista making coffee in a cafe', ''],
  ['p7', 'samples/pictures/p7.jpg', 'a teacher and students in a classroom', ''],
  ['p8', 'samples/pictures/p8.jpg', 'people cooking together in a kitchen', ''],
  ['p9', 'samples/pictures/p9.jpg', 'people on a train station platform', ''],
  ['p10', 'samples/pictures/p10.jpg', 'a family relaxing on a sandy beach', ''],
  ['p11', 'samples/pictures/p11.jpg', 'people riding bicycles in a park', ''],
  ['p12', 'samples/pictures/p12.jpg', 'a person shopping with a cart in a supermarket', ''],
  ['p13', 'samples/pictures/p13.jpg', 'friends at a birthday party with a cake', ''],
  ['p14', 'samples/pictures/p14.jpg', 'a person walking a dog in a park', ''],
  ['p15', 'samples/pictures/p15.jpg', 'people hiking on a mountain trail', ''],
  ['p16', 'samples/pictures/p16.jpg', 'students eating lunch in a school cafeteria', ''],
  ['p17', 'samples/pictures/p17.jpg', 'people camping with a tent near a campfire', ''],
  ['p18', 'samples/pictures/p18.jpg', 'friends having dinner at a restaurant', ''],
  ['p19', 'samples/pictures/p19.jpg', 'people painting pictures in an art class', ''],
  ['p20', 'samples/pictures/p20.jpg', 'people with umbrellas on a rainy street', ''],
  ['p21', 'samples/pictures/p21.jpg', 'a person watering flowers in a garden', ''],
  ['p22', 'samples/pictures/p22.jpg', 'people buying food at a street market stall', ''],
  ['p23', 'samples/pictures/p23.jpg', 'people reading and relaxing in a cafe', ''],
  ['p24', 'samples/pictures/p24.jpg', 'people playing basketball on an outdoor court', ''],
];

/**
 * 3. 질문에 답하기 (Respond to questions): 친구·이웃이 하는 짧은 조사 [id, 상황(소개), 질문 3개 (15초·15초·30초)]
 */
export const QSETS = {
  normal: [
    [
      'q1',
      'Imagine that a friend is writing a blog post about weekends. You agreed to answer some questions about how you spend your weekends.',
      [
        'What do you usually do on Saturday mornings?',
        'Do you prefer to stay home or go out on weekends? Why?',
        'Describe the best weekend you have had recently, and explain why you enjoyed it.',
      ],
    ],
    [
      'q2',
      'Imagine that a classmate is doing a survey about reading habits. You agreed to answer some questions about reading.',
      [
        'How often do you read books, and where do you usually read?',
        'Do you prefer paper books or e-books? Why?',
        'What kind of book would you recommend to a friend, and why?',
      ],
    ],
    [
      'q3',
      'Imagine that a neighbor is talking to you about local parks. You are answering some questions about parks in your area.',
      [
        'How often do you go to a park, and who do you usually go with?',
        'What do you like to do when you are at a park?',
        'What would make the parks in your area better? Explain your ideas.',
      ],
    ],
    [
      'q4',
      'Imagine that a friend is planning a trip and is asking you about traveling.',
      [
        'When was the last time you traveled, and where did you go?',
        'Do you like to plan every detail of a trip, or do you prefer to be spontaneous?',
        'What advice would you give to someone who is going on a trip for the first time?',
      ],
    ],
    [
      'q5',
      'Imagine that a student newspaper is doing a survey about smartphones. You agreed to answer some questions.',
      [
        'How many hours a day do you use your smartphone?',
        'What app do you use the most, and why?',
        'Do you think people use their smartphones too much? Explain why or why not.',
      ],
    ],
    [
      'q6',
      'Imagine that a friend is interested in cooking and asks you some questions about food.',
      [
        'How often do you cook at home?',
        'What is a dish you can make well?',
        'Do you think it is better to eat at home or at restaurants? Explain your reasons.',
      ],
    ],
    [
      'q7',
      'Imagine that a local community center is doing a survey about exercise. You agreed to answer some questions.',
      [
        'What kind of exercise do you do, and how often?',
        'Do you prefer exercising alone or with other people? Why?',
        'What is the best way for busy people to stay healthy? Give some examples.',
      ],
    ],
    [
      'q8',
      'Imagine that a classmate is doing a project about music. You are answering some questions about music.',
      [
        'What kind of music do you usually listen to?',
        'When and where do you listen to music the most?',
        'Describe a song or a singer that is special to you, and explain why.',
      ],
    ],
    [
      'q9',
      'Imagine that a friend is moving to your neighborhood and asks you about shopping.',
      [
        'Where do you usually go grocery shopping?',
        'Do you prefer shopping online or in stores? Why?',
        'What should someone think about before buying something expensive? Explain.',
      ],
    ],
    [
      'q10',
      'Imagine that a researcher is doing a survey about movies and TV shows. You agreed to answer some questions.',
      [
        'How often do you watch movies or TV shows?',
        'Do you prefer watching at home or at a movie theater? Why?',
        'Tell me about a movie or show you watched recently and what you thought about it.',
      ],
    ],
    [
      'q11',
      'Imagine that a friend is writing about public transportation in your city. You are answering some questions.',
      [
        'How do you usually get to school or other places you go often?',
        'How long does it take, and what do you do on the way?',
        'What could your city do to make public transportation better? Explain your ideas.',
      ],
    ],
    [
      'q12',
      'Imagine that a classmate is doing a survey about free time. You agreed to answer some questions about hobbies.',
      [
        'What is your favorite hobby, and when did you start it?',
        'How much time do you spend on it each week?',
        'Would you recommend this hobby to other people? Why or why not?',
      ],
    ],
  ],
  easy: [
    [
      'qe1',
      'Imagine that a friend is asking you about your weekends.',
      [
        'What do you do on weekends?',
        'Who do you spend your weekends with?',
        'What did you do last weekend? Tell me about it.',
      ],
    ],
    [
      'qe2',
      'Imagine that a classmate is asking you about books.',
      [
        'Do you like reading books?',
        'Where do you usually read?',
        'Tell me about a book you like and why you like it.',
      ],
    ],
    [
      'qe3',
      'Imagine that a neighbor is asking you about parks.',
      [
        'How often do you go to the park?',
        'What do you do at the park?',
        'Tell me about your favorite park and why you like it.',
      ],
    ],
    [
      'qe4',
      'Imagine that a friend is asking you about travel.',
      ['Do you like to travel?', 'Where did you go on your last trip?', 'Where do you want to travel next, and why?'],
    ],
    [
      'qe5',
      'Imagine that a classmate is asking you about your phone.',
      [
        'How much do you use your phone each day?',
        'What do you use your phone for the most?',
        'Can you live without your phone for a day? Why or why not?',
      ],
    ],
    [
      'qe6',
      'Imagine that a friend is asking you about food.',
      [
        'What is your favorite food?',
        'Do you cook at home?',
        'Tell me about a good restaurant you know and why you like it.',
      ],
    ],
    [
      'qe7',
      'Imagine that a friend is asking you about exercise.',
      [
        'Do you exercise often?',
        'What kind of exercise do you like?',
        'Why is exercise good for people? Tell me your ideas.',
      ],
    ],
    [
      'qe8',
      'Imagine that a classmate is asking you about music.',
      [
        'What kind of music do you like?',
        'When do you listen to music?',
        'Tell me about your favorite singer or song.',
      ],
    ],
    [
      'qe9',
      'Imagine that a neighbor is asking you about shopping.',
      ['Where do you go shopping?', 'Do you like shopping online?', 'Tell me about something you bought recently.'],
    ],
    [
      'qe10',
      'Imagine that a friend is asking you about movies.',
      [
        'How often do you watch movies?',
        'Do you like to watch movies at home or in a theater?',
        'Tell me about a movie you liked.',
      ],
    ],
    [
      'qe11',
      'Imagine that a friend is asking you about how you get around.',
      [
        'How do you go to school or other places?',
        'How long does it take?',
        'Do you like taking the bus or the subway? Why?',
      ],
    ],
    [
      'qe12',
      'Imagine that a classmate is asking you about hobbies.',
      ['What is your hobby?', 'How often do you do it?', 'Why do you enjoy your hobby? Tell me more.'],
    ],
  ],
};

/**
 * 4. 표 보고 답하기 (Respond to questions using information): [id, 제목, 표 줄 [시간·내용·장소], 묻는 사람의 말, 질문 (30초)]
 */
export const INFO = {
  normal: [
    [
      'i1',
      'Greenwood Library – Saturday Family Day',
      [
        ['10:00–11:00', 'Story time for children', 'Room A'],
        ['11:00–12:30', 'Book club: summer novels', 'Room B'],
        ['1:30–3:00', 'Free computer class for seniors', 'Computer lab'],
        ['3:00–4:00', 'Movie screening', 'Main hall (cancelled)'],
      ],
      'Hi, I heard about the family day at the library this Saturday, but I lost the schedule.',
      'I can only come in the afternoon. Could you tell me about everything happening after lunch?',
    ],
    [
      'i2',
      'Hillside High School – Field Trip to the Science Museum',
      [
        ['8:30', 'Meet at the school gate', 'Bus departs at 8:45'],
        ['10:00–11:30', 'Guided tour: space and planets', 'Second floor'],
        ['11:30–12:30', 'Lunch', 'Museum cafeteria (bring money)'],
        ['1:00–2:30', 'Hands-on robot workshop', 'Lab room 3'],
      ],
      "Hello, I'm a parent and I want to check the details of the field trip.",
      'Could you tell me what the students will do during the morning, before lunch?',
    ],
    [
      'i3',
      'Lakeside Community Center – Spring Classes',
      [
        ['Mon & Wed 7 p.m.', 'Beginner yoga', '$40 a month'],
        ['Tue 6 p.m.', 'Korean cooking', '$55 a month'],
        ['Thu 7 p.m.', 'Guitar for beginners', '$50 a month'],
        ['Sat 10 a.m.', 'Watercolor painting', '$45 a month'],
      ],
      "Hi, I'd like to sign up for a class at the community center, but I work late on most days.",
      "I'm only free on weekends and on Tuesday evenings. Could you tell me about the classes I can take?",
    ],
    [
      'i4',
      'City Spring Festival – Sunday Program',
      [
        ['11:00', 'Opening parade', 'Main street'],
        ['12:00–2:00', 'Food trucks and local market', 'City square'],
        ['2:00–3:00', 'Children’s magic show', 'Park stage'],
        ['6:00–8:00', 'Outdoor concert and fireworks', 'Riverside'],
      ],
      "Hi, I'm thinking about going to the spring festival with my family on Sunday.",
      'We have small kids. Could you tell me about the events that would be good for families with children?',
    ],
    [
      'i5',
      'University Orientation Week – Day 1',
      [
        ['9:00–10:00', 'Welcome speech', 'Main hall'],
        ['10:30–12:00', 'Campus tour', 'Meet at the library'],
        ['12:00–1:00', 'Free lunch', 'Student center'],
        ['2:00–4:00', 'Club fair', 'Sports field'],
      ],
      "Hi, I'm a new student and I missed the orientation email.",
      'I will arrive at around noon. Could you tell me what I can still join on the first day?',
    ],
    [
      'i6',
      'Seaside Hotel – Guest Information',
      [
        ['7:00–10:00', 'Breakfast buffet', 'Second floor restaurant'],
        ['9:00–6:00', 'Swimming pool', 'Rooftop (towels provided)'],
        ['Every hour', 'Free shuttle to the beach', 'Front entrance'],
        ['Until 11:00', 'Check-out time', 'Late check-out: $20'],
      ],
      "Hello, I'm staying at your hotel next week and I have a few questions.",
      'Could you tell me about all the free services the hotel offers?',
    ],
    [
      'i7',
      'Maple Apartment – Weekend Events',
      [
        ['Sat 9:00', 'Building clean-up', 'Parking lot'],
        ['Sat 2:00', 'Used book exchange', 'Lobby'],
        ['Sun 11:00', 'Kids’ drawing contest', 'Community room'],
        ['Sun 5:00', 'Residents’ meeting', 'Community room'],
      ],
      'Hi, I just moved into the building and I heard there are some events this weekend.',
      'Could you tell me about all the events happening on Sunday?',
    ],
    [
      'i8',
      'Riverside Sports Center – Summer Programs',
      [
        ['Mon–Fri 6 a.m.', 'Early morning swim', 'Pool, adults only'],
        ['Tue & Thu 4 p.m.', 'Kids’ soccer camp', 'Field B'],
        ['Wed 7 p.m.', 'Badminton club', 'Gym 2'],
        ['Sat 9 a.m.', 'Family tennis lessons', 'Tennis courts'],
      ],
      "Hi, I'm looking for some summer programs at the sports center.",
      'Could you tell me about the programs that my children could join?',
    ],
  ],
  easy: [
    [
      'ie1',
      'City Library – Saturday',
      [
        ['10:00', 'Story time for kids', 'Room A'],
        ['1:00', 'Book club', 'Room B'],
        ['3:00', 'Movie time', 'Main hall'],
      ],
      'Hi, I want to go to the library on Saturday.',
      'What can I do there in the afternoon?',
    ],
    [
      'ie2',
      'School Trip to the Zoo',
      [
        ['9:00', 'Meet at school', 'Main gate'],
        ['10:00', 'See the animals', 'Zoo'],
        ['12:00', 'Lunch', 'Picnic area'],
      ],
      "Hi, I'm a parent. I have a question about the school trip.",
      'What time do the students meet, and where?',
    ],
    [
      'ie3',
      'Community Center Classes',
      [
        ['Monday', 'Yoga', '$30'],
        ['Wednesday', 'Cooking', '$40'],
        ['Saturday', 'Drawing', '$35'],
      ],
      'Hi, I want to take a class at the community center.',
      'I am free only on weekends. Which class can I take, and how much is it?',
    ],
    [
      'ie4',
      'Spring Festival – Sunday',
      [
        ['11:00', 'Parade', 'Main street'],
        ['1:00', 'Food market', 'City square'],
        ['6:00', 'Concert', 'Park'],
      ],
      'Hi, I want to go to the spring festival.',
      'What can I see and do in the evening?',
    ],
    [
      'ie5',
      'New Student Day',
      [
        ['9:00', 'Welcome talk', 'Main hall'],
        ['10:00', 'School tour', 'Library'],
        ['12:00', 'Free lunch', 'Cafeteria'],
      ],
      "Hi, I'm a new student.",
      'What happens in the morning on the first day?',
    ],
    [
      'ie6',
      'Beach Hotel',
      [
        ['7:00–10:00', 'Breakfast', 'Restaurant'],
        ['9:00–6:00', 'Pool', 'Rooftop'],
        ['Until 11:00', 'Check-out', 'Front desk'],
      ],
      "Hi, I'm staying at your hotel.",
      'What time is breakfast, and where is it?',
    ],
    [
      'ie7',
      'Apartment Weekend',
      [
        ['Saturday 9:00', 'Cleaning day', 'Parking lot'],
        ['Sunday 11:00', 'Kids drawing contest', 'Community room'],
      ],
      'Hi, I live in this building.',
      'What events are there this weekend?',
    ],
    [
      'ie8',
      'Sports Center – Summer',
      [
        ['Monday 6:00 a.m.', 'Swimming', 'Pool'],
        ['Tuesday 4:00 p.m.', 'Kids soccer', 'Field'],
        ['Saturday 9:00 a.m.', 'Tennis', 'Courts'],
      ],
      "Hi, I'm looking for a sports class for my child.",
      'What can my child do, and when?',
    ],
  ],
};

/** 5. 의견 말하기 (Express an opinion): 60초 */
export const OPINIONS = {
  normal: [
    [
      'o1',
      'Some people think students should do homework every day. Others think homework is not necessary. What is your opinion? Give specific reasons and examples.',
    ],
    [
      'o2',
      'Do you agree or disagree with the following statement? It is better to live in a big city than in a small town. Give reasons and examples to support your opinion.',
    ],
    [
      'o3',
      'Which do you prefer: traveling alone or traveling with friends? Explain why, using specific reasons and examples.',
    ],
    [
      'o4',
      'Some people say children should start learning a foreign language at a very young age. Do you agree or disagree? Give reasons and examples.',
    ],
    [
      'o5',
      'What is the best way to spend a holiday: staying at home and relaxing, or going on a trip? Support your answer with reasons and examples.',
    ],
    [
      'o6',
      'Do you think people today spend too much time on their smartphones? Why or why not? Give specific reasons and examples.',
    ],
    [
      'o7',
      'Which is better for learning: taking classes online or taking classes in a classroom? Give reasons and examples to support your choice.',
    ],
    [
      'o8',
      'Do you agree or disagree with the following statement? Having a pet makes people happier. Use specific reasons and examples.',
    ],
    [
      'o9',
      'Some people prefer to cook at home, while others prefer to eat out. Which do you prefer, and why? Give specific examples.',
    ],
    [
      'o10',
      'Do you think it is important for students to have a part-time job? Why or why not? Support your opinion with reasons and examples.',
    ],
    [
      'o11',
      'What is the most important thing a person can do to stay healthy? Explain your choice with specific reasons and examples.',
    ],
    [
      'o12',
      'Do you agree or disagree? Reading books is more useful than watching videos for learning new things. Give reasons and examples.',
    ],
    [
      'o13',
      'Some people like to plan their free time carefully. Others like to decide at the last minute. Which do you prefer, and why?',
    ],
    [
      'o14',
      'Should people try to buy fewer things to protect the environment? Give your opinion with specific reasons and examples.',
    ],
    [
      'o15',
      'Which is more important when choosing a place to live: being close to nature or being close to stores and transportation? Explain your opinion.',
    ],
  ],
  easy: [
    ['oe1', 'Do you think homework is good for students? Why or why not?'],
    ['oe2', 'Do you like big cities or small towns better? Why?'],
    ['oe3', 'Do you like to travel alone or with friends? Why?'],
    ['oe4', 'Should children learn English when they are very young? Why or why not?'],
    ['oe5', 'Do you like to stay home or go on a trip on holidays? Why?'],
    ['oe6', 'Do people use their phones too much? Tell me what you think.'],
    ['oe7', 'Do you like online classes or classes at school better? Why?'],
    ['oe8', 'Is it good to have a pet? Why or why not?'],
    ['oe9', 'Do you like eating at home or eating at restaurants? Why?'],
    ['oe10', 'Should students have a part-time job? Why or why not?'],
    ['oe11', 'What is the best way to stay healthy? Tell me why.'],
    ['oe12', 'Is reading books better than watching videos? Why?'],
    ['oe13', 'Do you like to plan your weekend or decide at the last minute? Why?'],
    ['oe14', 'Do you think it is important to save energy at home? Why?'],
    ['oe15', 'Would you like to live near a park or near a shopping mall? Why?'],
  ],
};
