import puppeteer from 'puppeteer'

// ======================================================
// RENDER OVERLAY
// ======================================================

export default async function renderOverlay({

  quote,
  inputPng,
  outputPng,
  theme = 'golden'

}){

  const browser =
  await puppeteer.launch({

    headless:true,

    args:[

      '--no-sandbox',

      '--disable-setuid-sandbox'

    ]

  })

  try{

    const page =
    await browser.newPage()

    // ==================================================
    // THEMES
    // ==================================================

    let textColor = '#ffffff'
    let shadow = '0 0 30px rgba(255,255,255,0.4)'
    let overlay = 'rgba(0,0,0,0.45)'
    let font = 'Arial'

    // GOLDEN ISLAMIC
    if(theme === 'golden'){

      textColor = '#ffd166'

      shadow =
      '0 0 40px rgba(255,209,102,0.7)'

      overlay =
      'rgba(30,20,0,0.45)'

      font =
      'Georgia'

    }

    // DARK MOTIVATION
    if(theme === 'dark'){

      textColor = '#00e5ff'

      shadow =
      '0 0 35px rgba(0,229,255,0.8)'

      overlay =
      'rgba(0,0,0,0.55)'

      font =
      'Impact'

    }

    // NEON QUIZ
    if(theme === 'neon'){

      textColor = '#ff4dff'

      shadow =
      '0 0 40px rgba(255,77,255,0.8)'

      overlay =
      'rgba(20,0,35,0.5)'

      font =
      'Verdana'

    }

    // MINIMAL
    if(theme === 'minimal'){

      textColor = '#ffffff'

      shadow =
      '0 0 20px rgba(255,255,255,0.3)'

      overlay =
      'rgba(0,0,0,0.35)'

      font =
      'Helvetica'
    }

    // ==================================================
    // VIEWPORT
    // ==================================================

    await page.setViewport({

      width:1080,
      height:1920

    })

    // ==================================================
    // HTML
    // ==================================================

    await page.setContent(`

    <!DOCTYPE html>

    <html>

    <head>

      <style>

        *{

          margin:0;
          padding:0;
          box-sizing:border-box;
        }

        body{

          width:1080px;
          height:1920px;
          overflow:hidden;

          position:relative;

          display:flex;
          justify-content:center;
          align-items:center;

          font-family:${font};

          background:black;
        }

        .bg{

          position:absolute;

          inset:0;

          width:100%;
          height:100%;

          object-fit:cover;
        }

        .overlay{

          position:absolute;

          inset:0;

          background:${overlay};

          backdrop-filter:blur(1px);
        }

        .content{

          position:relative;

          width:85%;

          text-align:center;

          color:${textColor};

          font-size:72px;

          font-weight:bold;

          line-height:1.3;

          text-shadow:${shadow};

          padding:40px;

          border-radius:40px;

          backdrop-filter:blur(8px);

          background:rgba(255,255,255,0.05);

          border:1px solid rgba(255,255,255,0.08);

          box-shadow:

          0 0 40px rgba(0,0,0,0.4);
        }

        .footer{

          position:absolute;

          bottom:80px;

          width:100%;

          text-align:center;

          color:white;

          font-size:28px;

          opacity:0.8;

          letter-spacing:4px;
        }

      </style>

    </head>

    <body>

      <img

        class="bg"

        src="file://${inputPng}"

      />

      <div class="overlay"></div>

      <div class="content">

        ${quote}

      </div>

      <div class="footer">

        AUTOTUBE AI

      </div>

    </body>

    </html>

    `)

    // ==================================================
    // SCREENSHOT
    // ==================================================

    await page.screenshot({

      path:outputPng,

      type:'png'

    })

    return outputPng

  }catch(err){

    console.log(
      'Overlay Error:',
      err.message
    )

    throw err

  }finally{

    await browser.close()
  }
}
