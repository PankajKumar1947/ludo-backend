import cloudinary from '../config/cloudinaryConfig.js';
import streamifier from 'streamifier';

export const uploadImageToCloud = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "No image file uploaded"
      });
    }

    // Upload buffer to Cloudinary using a stream
    const streamUpload = (fileBuffer) => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'Ludo' },
          (error, result) => {
            if (result) resolve(result);
            else reject(error);
          }
        );
        streamifier.createReadStream(fileBuffer).pipe(stream);
      });
    };

    const result = await streamUpload(file.buffer);

    return res.status(200).json({
      success: true,
      imageUrl: result.secure_url,
      public_id: result.public_id,
      message: "Image uploaded successfully"
    });

  } catch (error) {
    console.error("Error in uploading image:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upload image to Cloud"
    });
  }
};
